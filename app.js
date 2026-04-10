const STORAGE_KEY = "backburner-mvp-items";
const SUPABASE_URL = "https://dorbawcjsrrkmreltpgw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6IhYipY9IltKu0Q6TzY3WA_J8A-nf1C";
const SUPABASE_TABLE = "app_state";
const SUPABASE_STATE_KEY = "shared";
const MINUTE_MAX = 60;
const MINUTE_STEP_HEIGHT = 52;
const SWIPE_THRESHOLD = 100;

const dumpForm = document.getElementById("dump-form");
const subtaskList = document.getElementById("subtask-list");
const addSubtaskButton = document.getElementById("add-subtask");
const subtaskTemplate = document.getElementById("subtask-template");
const quickWinForm = document.getElementById("quick-win-form");
const quickWinResult = document.getElementById("quick-win-result");
const seedDemoButton = document.getElementById("seed-demo");
const launcherGrid = document.getElementById("launcher-grid");
const dumpPanel = document.getElementById("dump-panel");
const quickPanel = document.getElementById("quick-panel");
const allPanel = document.getElementById("all-panel");
const minutePicker = document.getElementById("minute-picker");
const itemsBoard = document.getElementById("items-board");
const itemDetail = document.getElementById("item-detail");
const quickTimeScreen = document.getElementById("quick-time-screen");
const quickCardsScreen = document.getElementById("quick-cards-screen");
const allListScreen = document.getElementById("all-list-screen");
const allDetailScreen = document.getElementById("all-detail-screen");
const backToTimeButton = document.getElementById("back-to-time");
const backToListButton = document.getElementById("back-to-list");
const imageViewer = document.getElementById("image-viewer");
const closeViewerButton = document.getElementById("close-viewer");
const imageViewerMain = document.getElementById("image-viewer-main");
const imageViewerStrip = document.getElementById("image-viewer-strip");
const syncStatus = document.getElementById("sync-status");

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let items = loadItems();
let selectedMinute = 15;
let selectedItemId = items[0]?.id || null;
let quickDeck = [];
let activeQuickTask = null;
let celebrationTask = null;
let completionRedirectTimeoutId = null;
let activeTimer = {
  intervalId: null,
  remainingSeconds: 0,
};
let activeViewerImages = [];
let activeViewerIndex = 0;
let isHydratingFromRemote = false;
let saveTimeoutId = null;
let lastSavedSnapshot = JSON.stringify(items);

let minuteDrag = {
  active: false,
  pointerId: null,
  startY: 0,
  startMinute: 15,
};

let cardDrag = {
  active: false,
  pointerId: null,
  startX: 0,
  currentX: 0,
  cardId: null,
};

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const loaded = raw
      ? JSON.parse(raw).map((item) => ({
          ...item,
          taskMode: item.taskMode || "sequential",
          status: item.status || "active",
          links: item.links || [],
          completedSubtasks: item.completedSubtasks || [],
        }))
      : [];
    return loaded.map(normalizeItemTimeline);
  } catch (error) {
    console.error("Failed to load items", error);
    return [];
  }
}

function normalizeItemTimeline(item) {
  const nextItem = {
    ...item,
    log: (item.log || []).map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      type: entry.type || "note",
      title: entry.title ?? null,
      text: entry.text || "",
      createdAt: entry.createdAt || Date.now(),
      subtaskName: entry.subtaskName || null,
      images: entry.images || [],
    })),
  };

  const existingCompletionNames = new Set(
    nextItem.log
      .filter((entry) => entry.type === "completed_subtask" && entry.subtaskName)
      .map((entry) => entry.subtaskName)
  );

  (nextItem.completedSubtasks || []).forEach((subtask) => {
    if (existingCompletionNames.has(subtask.text)) {
      return;
    }

    nextItem.log.push({
      id: crypto.randomUUID(),
      type: "completed_subtask",
      title: null,
      text: "",
      createdAt: subtask.completedAt || nextItem.completedAt || nextItem.createdAt || Date.now(),
      subtaskName: subtask.text,
      images: [],
    });
  });

  nextItem.log.sort(compareTimelineEntries);
  return nextItem;
}

function compareTimelineEntries(a, b) {
  const aRelatedSubtask =
    a.type === "completed_subtask" ? a.subtaskName : extractSubtaskNameFromTitle(a.title);
  const bRelatedSubtask =
    b.type === "completed_subtask" ? b.subtaskName : extractSubtaskNameFromTitle(b.title);

  if (aRelatedSubtask && bRelatedSubtask && aRelatedSubtask === bRelatedSubtask) {
    if (a.type === "completed_subtask" && b.type !== "completed_subtask") {
      return -1;
    }

    if (b.type === "completed_subtask" && a.type !== "completed_subtask") {
      return 1;
    }
  }

  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }

  if (a.type === b.type) {
    return 0;
  }

  return a.type === "completed_subtask" ? -1 : 1;
}

function extractSubtaskNameFromTitle(title) {
  if (!title) {
    return null;
  }

  const prefix = "Notes for ";
  return title.startsWith(prefix) ? title.slice(prefix.length) : null;
}

function readFilesAsDataUrls(fileList) {
  if (!fileList?.length) {
    return Promise.resolve([]);
  }

  setSyncStatus("Photos stay local in this version", "idle");
  const files = Array.from(fileList || []);
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    )
  );
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  queueRemoteSave();
}

function setSyncStatus(message, tone = "idle") {
  if (!syncStatus) {
    return;
  }

  syncStatus.textContent = message;
  syncStatus.dataset.state = tone;
}

function sanitizeItemsForStorage(nextItems) {
  return nextItems.map((item) => ({
    ...item,
    links: [],
    log: (item.log || []).map((entry) => ({
      ...entry,
      images: [],
    })),
  }));
}

async function fetchRemoteItems() {
  if (!supabaseClient) {
    throw new Error("Supabase client did not load.");
  }

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select("items")
    .eq("key", SUPABASE_STATE_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Array.isArray(data?.items) ? data.items : [];
}

async function persistRemoteItems(nextItems) {
  if (!supabaseClient) {
    throw new Error("Supabase client did not load.");
  }

  const sanitizedItems = sanitizeItemsForStorage(nextItems);
  const { error } = await supabaseClient.from(SUPABASE_TABLE).upsert(
    {
      key: SUPABASE_STATE_KEY,
      items: sanitizedItems,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    throw error;
  }

  lastSavedSnapshot = JSON.stringify(nextItems);
}

function queueRemoteSave() {
  if (isHydratingFromRemote) {
    return;
  }

  if (!supabaseClient) {
    setSyncStatus("Supabase unavailable", "error");
    return;
  }

  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
  }

  setSyncStatus("Saving…", "saving");

  saveTimeoutId = window.setTimeout(async () => {
    saveTimeoutId = null;
    const snapshot = JSON.stringify(items);

    if (snapshot === lastSavedSnapshot) {
      setSyncStatus("Saved", "saved");
      return;
    }

    try {
      await persistRemoteItems(items);
      setSyncStatus("Saved", "saved");
    } catch (error) {
      console.error("Failed to save to Supabase", error);
      setSyncStatus("Save failed, kept locally", "error");
    }
  }, 250);
}

async function hydrateFromSupabase() {
  if (!supabaseClient) {
    setSyncStatus("Supabase unavailable, using local", "error");
    return;
  }

  setSyncStatus("Loading…", "saving");

  try {
    const remoteItems = await fetchRemoteItems();
    if (remoteItems.length) {
      isHydratingFromRemote = true;
      items = remoteItems.map((item) =>
        normalizeItemTimeline({
          ...item,
          taskMode: item.taskMode || "sequential",
          status: item.status || "active",
          links: [],
          completedSubtasks: item.completedSubtasks || [],
        })
      );
      selectedItemId = items[0]?.id || null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      renderItemsBoard();
      lastSavedSnapshot = JSON.stringify(items);
      setSyncStatus("Loaded from Supabase", "saved");
      return;
    }

    await persistRemoteItems(items);
    setSyncStatus("Supabase ready", "saved");
  } catch (error) {
    console.error("Failed to load from Supabase", error);
    setSyncStatus("Using local data only", "error");
  } finally {
    isHydratingFromRemote = false;
  }
}

function createSubtaskRow(values = {}) {
  const fragment = subtaskTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".subtask-row");
  const input = fragment.querySelector(".subtask-input");
  const minutes = fragment.querySelector(".subtask-minutes");
  const removeButton = fragment.querySelector(".remove-subtask");

  input.value = values.text || "";
  minutes.value = String(values.minutes || 15);

  removeButton.addEventListener("click", () => {
    row.remove();
  });

  subtaskList.appendChild(fragment);
}

function extractSubtasks() {
  return Array.from(subtaskList.querySelectorAll(".subtask-row"))
    .map((row) => {
      const text = row.querySelector(".subtask-input").value.trim();
      const minutes = Number(row.querySelector(".subtask-minutes").value);

      if (!text) {
        return null;
      }

      return {
        id: crypto.randomUUID(),
        text,
        minutes,
        done: false,
      };
    })
    .filter(Boolean);
}

function resetDumpForm() {
  dumpForm.reset();
  subtaskList.innerHTML = "";
  createSubtaskRow();
}

function createItem(formData) {
  return {
    id: crypto.randomUUID(),
    title: formData.get("title").trim(),
    taskMode: formData.get("taskMode") || "sequential",
    subtasks: extractSubtasks(),
    completedSubtasks: [],
    log: [],
    links: [],
    status: "active",
    createdAt: Date.now(),
  };
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRichText(value) {
  const escaped = escapeHtml(value);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer">$1</a>'
  );
  return withLinks.replace(/\n/g, "<br />");
}

function getAvailableSubtasks(maxMinutes) {
  return items.filter((item) => item.status !== "completed").flatMap((item) => {
    const taskMode = item.taskMode || "sequential";
    const unfinishedSubtasks = item.subtasks.filter((subtask) => !subtask.done);

    const eligibleSubtasks =
      taskMode === "flexible" ? unfinishedSubtasks : unfinishedSubtasks.slice(0, 1);

    return eligibleSubtasks
      .filter((subtask) => subtask.minutes <= maxMinutes)
      .map((subtask) => ({
        id: `${item.id}:${subtask.id}`,
        itemId: item.id,
        itemTitle: item.title,
        subtaskId: subtask.id,
        text: subtask.text,
        minutes: subtask.minutes,
      }));
  });
}

function renderMinutePicker() {
  const options = Array.from({ length: MINUTE_MAX + 1 }, (_, index) => {
    const selectedClass = index === selectedMinute ? "minute-option selected" : "minute-option";
    return `<button class="${selectedClass}" type="button" data-minute="${index}">${index} min</button>`;
  }).join("");

  minutePicker.innerHTML = `
    <div class="selection-band"></div>
    <div id="minute-picker-track" class="minute-picker-track">${options}</div>
  `;

  const track = document.getElementById("minute-picker-track");
  const frameHeight = 220;
  const offset = (frameHeight / 2) - (MINUTE_STEP_HEIGHT / 2) - (selectedMinute * MINUTE_STEP_HEIGHT);
  track.style.transform = `translateY(${offset}px)`;
}

function buildQuickDeck() {
  quickDeck = shuffle(getAvailableSubtasks(selectedMinute)).slice(0, 8);
  activeQuickTask = null;
}

function renderQuickWinArea() {
  if (celebrationTask) {
    quickWinResult.className = "quick-win-result active";
    quickWinResult.innerHTML = `
      <div class="celebration-screen">
        <div>
          <p class="celebration-line">Nice work 🎉</p>
          <h3>${escapeHtml(celebrationTask.text)}</h3>
          <p class="hero-copy">You picked something real to work on right now.</p>
        </div>
      </div>
    `;
    return;
  }

  if (activeQuickTask) {
    quickWinResult.className = "quick-win-result active";
    quickWinResult.innerHTML = `
      <div class="selected-task-panel">
        <p class="celebration-line">Nice choice. You picked something doable 🎉</p>
        <p class="section-label">Doing now</p>
        <h3>${escapeHtml(activeQuickTask.text)}</h3>
        <p class="hero-copy">${escapeHtml(activeQuickTask.itemTitle)} · ${activeQuickTask.minutes} min</p>
        <div class="timer-shell soft-card">
          <div>
            <p class="section-label">Optional push</p>
            <div class="timer-readout" id="timer-readout">${formatTimer(
              activeTimer.remainingSeconds || activeQuickTask.minutes * 60
            )}</div>
          </div>
          <div class="item-actions">
            <button class="chip-button" type="button" data-action="start-timer">
              Start ${activeQuickTask.minutes}-minute timer
            </button>
            <button class="chip-button" type="button" data-action="stop-timer">
              Stop timer
            </button>
          </div>
        </div>
        <div class="note-box">
          <label class="field">
            <span>Add a title if you want</span>
            <input id="completion-note-title" type="text" placeholder="What this note is about" />
          </label>
          <label class="field">
            <span>Leave a note while you work</span>
            <textarea id="completion-note" rows="4" placeholder="What did you do or find?"></textarea>
          </label>
          <div class="item-actions">
            <button class="primary-button secondary-tone" type="button" data-action="save-note">
              Save note
            </button>
            <button class="chip-button" type="button" data-action="complete-active">
              Mark subtask complete
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (!quickDeck.length) {
    quickWinResult.className = "quick-win-result";
    quickWinResult.innerHTML =
      "No matching subtasks yet. Try a bigger time amount or add more timed subtasks in Dump.";
    return;
  }

  const cards = quickDeck
    .slice(0, 3)
    .map(
      (task, index) => `
        <article class="quick-card" data-depth="${index}" data-card-id="${task.id}">
          <p class="section-label">${index === 0 ? "Swipe to choose" : "Up next"}</p>
          <h3>${escapeHtml(task.text)}</h3>
          <p class="hero-copy">${escapeHtml(task.itemTitle)} · ${task.minutes} min</p>
          <div class="swipe-hint">
            <span>Swipe left to pass</span>
            <span>Swipe right for now</span>
          </div>
        </article>
      `
    )
    .join("");

  quickWinResult.className = "quick-win-result active";
  quickWinResult.innerHTML = `
    <div class="quick-card-stack">${cards}</div>
  `;
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function stopActiveTimer() {
  if (activeTimer.intervalId) {
    clearInterval(activeTimer.intervalId);
  }

  activeTimer = {
    intervalId: null,
    remainingSeconds: 0,
  };
}

function startTimer(minutes) {
  stopActiveTimer();
  activeTimer.remainingSeconds = minutes * 60;
  const readout = document.getElementById("timer-readout");
  if (readout) {
    readout.textContent = formatTimer(activeTimer.remainingSeconds);
  }

  activeTimer.intervalId = window.setInterval(() => {
    activeTimer.remainingSeconds -= 1;
    const liveReadout = document.getElementById("timer-readout");

    if (activeTimer.remainingSeconds <= 0) {
      stopActiveTimer();
      const finishedReadout = document.getElementById("timer-readout");
      if (finishedReadout) {
        finishedReadout.textContent = "Done!";
      }
      return;
    }

    if (liveReadout) {
      liveReadout.textContent = formatTimer(activeTimer.remainingSeconds);
    }
  }, 1000);
}

function selectQuickTask(taskId) {
  activeQuickTask = quickDeck.find((task) => task.id === taskId) || null;
  celebrationTask = activeQuickTask;
  stopActiveTimer();
  renderQuickWinArea();
  window.setTimeout(() => {
    if (!celebrationTask || celebrationTask.id !== activeQuickTask?.id) {
      return;
    }

    celebrationTask = null;
    renderQuickWinArea();
  }, 900);
}

function skipQuickTask(taskId) {
  quickDeck = quickDeck.filter((task) => task.id !== taskId);
  if (activeQuickTask?.id === taskId) {
    activeQuickTask = null;
    stopActiveTimer();
  }
  celebrationTask = null;
  renderQuickWinArea();
}

function markSubtaskDone(itemId, subtaskId) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return null;
  }

  const subtask = item.subtasks.find((entry) => entry.id === subtaskId);
  if (!subtask) {
    return null;
  }

  item.subtasks = item.subtasks.filter((entry) => entry.id !== subtaskId);
  item.completedSubtasks.push({
    ...subtask,
    done: true,
    completedAt: Date.now(),
  });
  item.log.push({
    id: crypto.randomUUID(),
    type: "completed_subtask",
    title: null,
    text: "",
    createdAt: Date.now(),
    subtaskName: subtask.text,
    images: [],
  });
  item.log.sort(compareTimelineEntries);
  const completed = item.subtasks.length === 0;
  if (completed) {
    item.status = "completed";
    item.completedAt = Date.now();
  }
  saveItems();
  renderItemsBoard();
  renderItemDetail();
  return { item, completed };
}

function appendLog(itemId, note, images = []) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.log.push({
    id: crypto.randomUUID(),
    type: "note",
    title: null,
    text: note,
    createdAt: Date.now(),
    subtaskName: null,
    images,
  });
  item.log.sort(compareTimelineEntries);
  saveItems();
  renderItemsBoard();
  renderItemDetail();
}

function appendTitledLog(itemId, title, note, images = []) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.log.push({
    id: crypto.randomUUID(),
    type: "note",
    title,
    text: note,
    createdAt: Date.now(),
    subtaskName: null,
    images,
  });
  item.log.sort(compareTimelineEntries);
  saveItems();
  renderItemsBoard();
  renderItemDetail();
}

function appendOptionalTitledLog(itemId, title, fallbackTitle, note, images = []) {
  const finalTitle = title?.trim() ? title.trim() : fallbackTitle;
  appendTitledLog(itemId, finalTitle, note, images);
}

function renderItemsBoard() {
  if (!items.length) {
    itemsBoard.className = "items-board empty-state";
    itemsBoard.textContent = "No items yet. Use Dump to create your first backburner task.";
    itemDetail.className = "item-detail empty-state";
    itemDetail.textContent = "Select a task to open it and edit subtasks or notes.";
    return;
  }

  if (!selectedItemId || !items.some((item) => item.id === selectedItemId)) {
    selectedItemId = items[0].id;
  }

  const activeItems = items.filter((item) => item.status !== "completed");
  const completedItems = items.filter((item) => item.status === "completed");

  itemsBoard.className = "items-board";
  itemsBoard.innerHTML = `
    <div class="section-stack">
      <p class="section-title">Active</p>
      ${
        activeItems.length
          ? activeItems.map((item) => renderItemListButton(item)).join("")
          : '<p class="meta-copy">No active tasks.</p>'
      }
    </div>
    <div class="section-stack">
      <p class="section-title">Completed</p>
      ${
        completedItems.length
          ? completedItems.map((item) => renderItemListButton(item)).join("")
          : '<p class="meta-copy">No completed tasks yet.</p>'
      }
    </div>
  `;

  renderItemDetail();
}

function renderItemListButton(item) {
  const isCompleted = item.status === "completed";
  return `
    <button
      class="item-list-button ${item.id === selectedItemId ? "active" : ""}"
      type="button"
      data-action="open-item"
      data-item-id="${item.id}"
    >
      <p class="section-label">${isCompleted ? "Completed task" : "Backburner item"}</p>
      <strong>${escapeHtml(item.title)}</strong>
      <p class="hero-copy">
        ${
          isCompleted
            ? `Completed ${item.completedAt ? formatDate(item.completedAt) : ""}`
            : `${item.subtasks.filter((task) => !task.done).length} open steps · ${
                (item.taskMode || "sequential") === "flexible" ? "Any order" : "In order"
              }`
        }
      </p>
    </button>
  `;
}

function renderItemDetail() {
  const item = items.find((entry) => entry.id === selectedItemId);
  if (!item) {
    itemDetail.className = "item-detail empty-state";
    itemDetail.textContent = "Select a task to open it and edit subtasks or notes.";
    return;
  }

  itemDetail.className = "item-detail";
  itemDetail.innerHTML = `
    <div class="detail-grid">
      <div class="card-heading compact">
        <div>
          <p class="section-label">Editing</p>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <button class="ghost-button danger-button" type="button" data-action="delete-item" data-item-id="${item.id}">
          Delete
        </button>
      </div>

      <label class="field">
        <span>Task name</span>
        <input id="detail-title" type="text" value="${escapeHtml(item.title)}" ${
          item.status === "completed" ? "readonly" : ""
        } />
      </label>

      <label class="field">
        <span>Subtask flow</span>
        <select id="detail-task-mode" ${item.status === "completed" ? "disabled" : ""}>
          <option value="sequential" ${(item.taskMode || "sequential") === "sequential" ? "selected" : ""}>
            Do in order
          </option>
          <option value="flexible" ${(item.taskMode || "sequential") === "flexible" ? "selected" : ""}>
            Can be done in any order
          </option>
        </select>
      </label>

      <div class="soft-card">
        <div class="card-heading compact">
          <div>
            <p class="section-label">Subtasks</p>
            <h3>Change anything</h3>
            <p class="meta-copy">Drag a subtask row to move it around.</p>
          </div>
          <button class="ghost-button" type="button" data-action="add-detail-subtask" data-item-id="${item.id}" ${
            item.status === "completed" ? "disabled" : ""
          }>
            Add subtask
          </button>
        </div>
        <div class="detail-grid">
          ${item.subtasks
            .map(
              (subtask) => `
                <div class="subtask-editor-row">
                  <input
                    class="draggable-subtask"
                    draggable="${item.status !== "completed"}"
                    data-item-id="${item.id}"
                    data-subtask-id="${subtask.id}"
                    value="${escapeHtml(subtask.text)}"
                    type="text"
                    data-field="subtask-text"
                    data-item-id="${item.id}"
                    data-subtask-id="${subtask.id}"
                    ${item.status === "completed" ? "readonly" : ""}
                  />
                  <select data-field="subtask-minutes" data-item-id="${item.id}" data-subtask-id="${subtask.id}" ${
                    item.status === "completed" ? "disabled" : ""
                  }>
                    ${Array.from({ length: MINUTE_MAX + 1 }, (_, minute) => `
                      <option value="${minute}" ${minute === subtask.minutes ? "selected" : ""}>${minute} min</option>
                    `).join("")}
                  </select>
                  <button
                    class="icon-button"
                    type="button"
                    data-action="delete-subtask"
                    data-item-id="${item.id}"
                    data-subtask-id="${subtask.id}"
                    aria-label="Delete subtask"
                    ${item.status === "completed" ? "disabled" : ""}
                  >
                    ×
                  </button>
                </div>
              `
            )
            .join("")}
        </div>
      </div>

      <div class="soft-card">
        <div class="card-heading compact">
          <div>
            <p class="section-label">Notes</p>
            <h3>Log</h3>
          </div>
        </div>
        <div class="detail-grid">
          <label class="field">
            <span>Add a title if you want</span>
            <input id="detail-note-title" type="text" placeholder="What this note is about" />
          </label>
          <label class="field">
            <span>Add a note</span>
            <textarea id="detail-note-input" rows="4" placeholder="What did you discover or decide?"></textarea>
          </label>
          <button class="primary-button secondary-tone" type="button" data-action="add-note" data-item-id="${item.id}">
            Save note
          </button>
          ${item.log.length
            ? item.log.map((entry) => renderLogEntry(item.id, entry)).join("")
            : '<p class="meta-copy">No notes yet.</p>'}
        </div>
      </div>
    </div>
  `;
}

function renderLogEntry(itemId, entry) {
  if (entry.type === "completed_subtask") {
    return `
      <div class="note-editor-row soft-card">
        <div>
          <p class="log-title">✅ Completed: ${escapeHtml(entry.subtaskName || "")}</p>
          <p class="log-date">${formatDate(entry.createdAt)}</p>
        </div>
        <button
          class="icon-button"
          type="button"
          data-action="delete-note"
          data-item-id="${itemId}"
          data-note-id="${entry.id}"
          aria-label="Delete log entry"
        >
          ×
        </button>
      </div>
    `;
  }

  const mediaStack = renderLogMediaStack(itemId, entry);
  return `
    <div class="note-editor-row soft-card">
      <div class="note-content">
        <div>
          ${entry.title ? `<p class="log-title">${escapeHtml(entry.title)}</p>` : ""}
          <p class="log-date">${formatDate(entry.createdAt)}</p>
          <p>${formatRichText(entry.text)}</p>
        </div>
        ${mediaStack}
      </div>
      <button
        class="icon-button"
        type="button"
        data-action="delete-note"
        data-item-id="${itemId}"
        data-note-id="${entry.id}"
        aria-label="Delete note"
      >
        ×
      </button>
    </div>
  `;
}

function renderLogMediaStack(itemId, entry) {
  if (!entry.images?.length) {
    return "";
  }

  const thumbs = entry.images
    .slice(0, 3)
    .map(
      (image, index) => `
        <button
          class="note-media-thumb"
          type="button"
          data-action="open-images"
          data-item-id="${itemId}"
          data-note-id="${entry.id}"
          data-image-index="${index}"
        >
          <img src="${image}" alt="Attached note image ${index + 1}" />
        </button>
      `
    )
    .join("");

  const extra = entry.images.length > 3 ? `<div class="note-media-count">+${entry.images.length - 3}</div>` : "";
  return `<div class="note-media-stack">${thumbs}${extra}</div>`;
}

function openImageViewer(images, startIndex = 0) {
  activeViewerImages = images;
  activeViewerIndex = startIndex;
  imageViewer.classList.remove("hidden");
  imageViewer.setAttribute("aria-hidden", "false");
  renderImageViewer();
}

function closeImageViewer() {
  imageViewer.classList.add("hidden");
  imageViewer.setAttribute("aria-hidden", "true");
  activeViewerImages = [];
  activeViewerIndex = 0;
}

function renderImageViewer() {
  const current = activeViewerImages[activeViewerIndex];
  if (!current) {
    imageViewerMain.innerHTML = "";
    imageViewerStrip.innerHTML = "";
    return;
  }

  imageViewerMain.innerHTML = `<img src="${current}" alt="Expanded note image" />`;
  imageViewerStrip.innerHTML = activeViewerImages
    .map(
      (image, index) => `
        <button class="image-viewer-thumb ${index === activeViewerIndex ? "active" : ""}" type="button" data-viewer-index="${index}">
          <img src="${image}" alt="Gallery image ${index + 1}" />
        </button>
      `
    )
    .join("");
}

function openPanel(panel) {
  launcherGrid.classList.add("hidden");
  dumpPanel.classList.add("hidden");
  quickPanel.classList.add("hidden");
  allPanel.classList.add("hidden");
  panel.classList.remove("hidden");
}

function closePanels() {
  if (completionRedirectTimeoutId) {
    clearTimeout(completionRedirectTimeoutId);
    completionRedirectTimeoutId = null;
  }
  stopActiveTimer();
  dumpPanel.classList.add("hidden");
  quickPanel.classList.add("hidden");
  allPanel.classList.add("hidden");
  launcherGrid.classList.remove("hidden");
}

function showQuickTimeScreen() {
  if (completionRedirectTimeoutId) {
    clearTimeout(completionRedirectTimeoutId);
    completionRedirectTimeoutId = null;
  }
  stopActiveTimer();
  celebrationTask = null;
  activeQuickTask = null;
  quickTimeScreen.classList.remove("hidden");
  quickCardsScreen.classList.add("hidden");
}

function showQuickCardsScreen() {
  quickTimeScreen.classList.add("hidden");
  quickCardsScreen.classList.remove("hidden");
}

function showAllListScreen() {
  allListScreen.classList.remove("hidden");
  allDetailScreen.classList.add("hidden");
}

function showAllDetailScreen() {
  allListScreen.classList.add("hidden");
  allDetailScreen.classList.remove("hidden");
}

function updateItemTitle(itemId, value) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.title = value.trim() || "Untitled task";
  saveItems();
  renderItemsBoard();
}

function updateTaskMode(itemId, value) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.taskMode = value === "flexible" ? "flexible" : "sequential";
  saveItems();
  renderItemsBoard();
}

function updateSubtaskText(itemId, subtaskId, value) {
  const item = items.find((entry) => entry.id === itemId);
  const subtask = item?.subtasks.find((entry) => entry.id === subtaskId);
  if (!subtask) {
    return;
  }

  subtask.text = value;
  saveItems();
}

function updateSubtaskMinutes(itemId, subtaskId, value) {
  const item = items.find((entry) => entry.id === itemId);
  const subtask = item?.subtasks.find((entry) => entry.id === subtaskId);
  if (!subtask) {
    return;
  }

  subtask.minutes = Number(value);
  saveItems();
  renderItemsBoard();
}

function addDetailSubtask(itemId) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.subtasks.push({
    id: crypto.randomUUID(),
    text: "New subtask",
    minutes: 10,
    done: false,
  });
  saveItems();
  renderItemsBoard();
}

function deleteSubtask(itemId, subtaskId) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.subtasks = item.subtasks.filter((subtask) => subtask.id !== subtaskId);
  saveItems();
  renderItemsBoard();
}

function moveSubtaskToIndex(itemId, subtaskId, targetIndex) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  const index = item.subtasks.findIndex((subtask) => subtask.id === subtaskId);
  if (index === -1) {
    return;
  }
  if (targetIndex < 0 || targetIndex >= item.subtasks.length) {
    return;
  }

  const [moved] = item.subtasks.splice(index, 1);
  item.subtasks.splice(targetIndex, 0, moved);
  saveItems();
  renderItemsBoard();
}

function deleteItem(itemId) {
  items = items.filter((item) => item.id !== itemId);
  selectedItemId = items[0]?.id || null;
  saveItems();
  renderItemsBoard();
}

function deleteNote(itemId, noteId) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.log = item.log.filter((entry) => entry.id !== noteId);
  saveItems();
  renderItemsBoard();
}

dumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(dumpForm);
  const item = createItem(formData);
  items.unshift(item);
  selectedItemId = item.id;
  saveItems();
  resetDumpForm();
  renderItemsBoard();
  closePanels();
});

addSubtaskButton.addEventListener("click", () => {
  createSubtaskRow();
});

quickWinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  buildQuickDeck();
  renderQuickWinArea();
  showQuickCardsScreen();
});

seedDemoButton.addEventListener("click", () => {
  items = [
    {
      id: crypto.randomUUID(),
      title: "Learn about the adoption system in Japan",
      taskMode: "sequential",
      status: "active",
      completedSubtasks: [
        {
          id: crypto.randomUUID(),
          text: "Find the national page for adoption",
          minutes: 10,
          done: true,
          completedAt: Date.now() - 9600000,
        },
      ],
      subtasks: [
        { id: crypto.randomUUID(), text: "Read prefecture-level adoption guidance", minutes: 15, done: false },
        { id: crypto.randomUUID(), text: "Write down eligibility questions", minutes: 10, done: false },
      ],
      log: [
        {
          id: crypto.randomUUID(),
          type: "completed_subtask",
          title: null,
          text: "",
          subtaskName: "Find the national page for adoption",
          createdAt: Date.now() - 9600000,
        },
        {
          id: crypto.randomUUID(),
          type: "note",
          title: "Notes for Find the national page for adoption",
          text: "Found the official national overview page and saved it here.\nhttps://www.mhlw.go.jp",
          createdAt: Date.now() - 8600000,
          subtaskName: null,
        },
      ],
      createdAt: Date.now() - 17200000,
    },
    {
      id: crypto.randomUUID(),
      title: "Plan summer trip ideas",
      taskMode: "sequential",
      status: "active",
      subtasks: [
        { id: crypto.randomUUID(), text: "Save 3 destination ideas", minutes: 5, done: false },
        { id: crypto.randomUUID(), text: "Check rough flight prices", minutes: 15, done: false },
      ],
      log: [],
      createdAt: Date.now() - 4200000,
    },
  ];

  selectedItemId = items[0].id;
  saveItems();
  renderItemsBoard();
});

document.querySelectorAll("[data-open-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    const panelId = button.getAttribute("data-open-panel");
    openPanel(document.getElementById(panelId));
    if (panelId === "quick-panel") {
      showQuickTimeScreen();
    }
    if (panelId === "all-panel") {
      renderItemsBoard();
      showAllListScreen();
    }
  });
});

document.querySelectorAll("[data-close-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    closePanels();
  });
});

backToTimeButton.addEventListener("click", () => {
  showQuickTimeScreen();
});

backToListButton.addEventListener("click", () => {
  showAllListScreen();
});

minutePicker.addEventListener("click", (event) => {
  const option = event.target.closest("[data-minute]");
  if (!option) {
    return;
  }

  selectedMinute = Number(option.getAttribute("data-minute"));
  renderMinutePicker();
});

minutePicker.addEventListener("pointerdown", (event) => {
  minuteDrag = {
    active: true,
    pointerId: event.pointerId,
    startY: event.clientY,
    startMinute: selectedMinute,
  };
  minutePicker.classList.add("dragging");
  minutePicker.setPointerCapture(event.pointerId);
});

minutePicker.addEventListener("pointermove", (event) => {
  if (!minuteDrag.active || event.pointerId !== minuteDrag.pointerId) {
    return;
  }

  const deltaY = event.clientY - minuteDrag.startY;
  const minuteOffset = Math.round(deltaY / MINUTE_STEP_HEIGHT);
  selectedMinute = Math.max(0, Math.min(MINUTE_MAX, minuteDrag.startMinute - minuteOffset));
  renderMinutePicker();
});

function endMinuteDrag(event) {
  if (!minuteDrag.active || event.pointerId !== minuteDrag.pointerId) {
    return;
  }

  minuteDrag.active = false;
  minutePicker.classList.remove("dragging");
  minutePicker.releasePointerCapture(event.pointerId);
}

minutePicker.addEventListener("pointerup", endMinuteDrag);
minutePicker.addEventListener("pointercancel", endMinuteDrag);

quickWinResult.addEventListener("pointerdown", (event) => {
  const card = event.target.closest(".quick-card[data-depth='0']");
  if (!card) {
    return;
  }

  cardDrag = {
    active: true,
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: 0,
    cardId: card.getAttribute("data-card-id"),
  };
  card.setPointerCapture(event.pointerId);
});

quickWinResult.addEventListener("pointermove", (event) => {
  if (!cardDrag.active || event.pointerId !== cardDrag.pointerId) {
    return;
  }

  const card = quickWinResult.querySelector(`.quick-card[data-card-id="${cardDrag.cardId}"]`);
  if (!card) {
    return;
  }

  const deltaX = event.clientX - cardDrag.startX;
  cardDrag.currentX = deltaX;
  const rotate = deltaX / 14;
  card.style.transform = `translateX(${deltaX}px) rotate(${rotate}deg)`;
  const warmness = Math.max(0, Math.min(1, deltaX / 160));
  if (warmness > 0) {
    card.style.background = `linear-gradient(180deg, rgba(255, ${255 - Math.round(35 * warmness)}, ${255 - Math.round(110 * warmness)}, 1), rgba(255, ${244 - Math.round(28 * warmness)}, ${239 - Math.round(95 * warmness)}, 0.98))`;
    card.style.borderColor = `rgba(214, 112, 34, ${0.18 + warmness * 0.35})`;
  } else {
    card.style.background = "";
    card.style.borderColor = "";
  }
});

function endCardDrag(event) {
  if (!cardDrag.active || event.pointerId !== cardDrag.pointerId) {
    return;
  }

  const card = quickWinResult.querySelector(`.quick-card[data-card-id="${cardDrag.cardId}"]`);
  const deltaX = cardDrag.currentX;
  const chosenCardId = cardDrag.cardId;

  cardDrag = {
    active: false,
    pointerId: null,
    startX: 0,
    currentX: 0,
    cardId: null,
  };

  if (card) {
    card.releasePointerCapture(event.pointerId);
  }

  if (deltaX > SWIPE_THRESHOLD) {
    selectQuickTask(chosenCardId);
    return;
  }

  if (deltaX < -SWIPE_THRESHOLD) {
    skipQuickTask(chosenCardId);
    return;
  }

  renderQuickWinArea();
}

quickWinResult.addEventListener("pointerup", endCardDrag);
quickWinResult.addEventListener("pointercancel", endCardDrag);

quickWinResult.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.getAttribute("data-action");
  if (!action) {
    return;
  }

  if (action === "save-note" && activeQuickTask) {
    const titleField = document.getElementById("completion-note-title");
    const noteField = document.getElementById("completion-note");
    const note = noteField.value.trim();
    if (!note) {
      noteField.focus();
      return;
    }
    readFilesAsDataUrls().then((images) => {
      appendOptionalTitledLog(
        activeQuickTask.itemId,
        titleField?.value || "",
        `Notes for ${activeQuickTask.text}`,
        note,
        images
      );
      if (titleField) {
        titleField.value = "";
      }
      noteField.value = "";
    });
  }

  if (action === "complete-active" && activeQuickTask) {
    const titleField = document.getElementById("completion-note-title");
    const noteField = document.getElementById("completion-note");
    const note = noteField?.value.trim();
    readFilesAsDataUrls().then((images) => {
      if (note) {
        appendOptionalTitledLog(
          activeQuickTask.itemId,
          titleField?.value || "",
          `Notes for ${activeQuickTask.text}`,
          note,
          images
        );
      }
      const result = markSubtaskDone(activeQuickTask.itemId, activeQuickTask.subtaskId);
      stopActiveTimer();
      quickDeck = [];
      activeQuickTask = null;
      celebrationTask = null;
      quickWinResult.className = "quick-win-result active";
      quickWinResult.innerHTML = `
        <div class="celebration-screen">
          <div>
            <p class="celebration-line">Congratulations 🎉</p>
            <h3>${escapeHtml(result?.item?.title || "Task complete")}</h3>
            <p class="hero-copy">${
              result?.completed
                ? "That task has been moved into Completed."
                : "That subtask is complete and your progress is saved."
            }</p>
          </div>
        </div>
      `;
      completionRedirectTimeoutId = window.setTimeout(() => {
        closePanels();
      }, 1200);
    });
  }

  if (action === "start-timer" && activeQuickTask) {
    startTimer(activeQuickTask.minutes);
  }

  if (action === "stop-timer") {
    stopActiveTimer();
    renderQuickWinArea();
  }
});

itemsBoard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='open-item']");
  if (!button) {
    return;
  }

  selectedItemId = button.getAttribute("data-item-id");
  renderItemsBoard();
  showAllDetailScreen();
});

itemDetail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.getAttribute("data-action");
  const itemId = button.getAttribute("data-item-id");
  const subtaskId = button.getAttribute("data-subtask-id");
  const noteId = button.getAttribute("data-note-id");

  if (action === "delete-item") {
    deleteItem(itemId);
  }

  if (action === "add-detail-subtask") {
    addDetailSubtask(itemId);
  }

  if (action === "delete-subtask") {
    deleteSubtask(itemId, subtaskId);
  }

  if (action === "add-note") {
    const titleField = document.getElementById("detail-note-title");
    const field = document.getElementById("detail-note-input");
    const note = field.value.trim();
    if (!note) {
      field.focus();
      return;
    }
    readFilesAsDataUrls().then((images) => {
      if (titleField?.value.trim()) {
        appendTitledLog(itemId, titleField.value.trim(), note, images);
        titleField.value = "";
      } else {
        appendLog(itemId, note, images);
      }
      field.value = "";
    });
  }

  if (action === "delete-note") {
    deleteNote(itemId, noteId);
  }

  if (action === "open-images") {
    const item = items.find((entry) => entry.id === itemId);
    const noteEntry = item?.log.find((entry) => entry.id === noteId);
    if (noteEntry?.images?.length) {
      openImageViewer(noteEntry.images, Number(button.getAttribute("data-image-index")) || 0);
    }
  }

});

closeViewerButton.addEventListener("click", () => {
  closeImageViewer();
});

imageViewer.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-viewer]")) {
    closeImageViewer();
    return;
  }

  const thumb = event.target.closest("[data-viewer-index]");
  if (thumb) {
    activeViewerIndex = Number(thumb.getAttribute("data-viewer-index"));
    renderImageViewer();
  }
});

itemDetail.addEventListener("input", (event) => {
  const target = event.target;
  const field = target.getAttribute("data-field");
  const itemId = target.getAttribute("data-item-id");
  const subtaskId = target.getAttribute("data-subtask-id");

  if (field === "subtask-text") {
    updateSubtaskText(itemId, subtaskId, target.value);
  }
});

itemDetail.addEventListener("change", (event) => {
  const target = event.target;

  if (target.id === "detail-title") {
    updateItemTitle(selectedItemId, target.value);
    return;
  }

  if (target.id === "detail-task-mode") {
    updateTaskMode(selectedItemId, target.value);
    return;
  }

  const field = target.getAttribute("data-field");
  const itemId = target.getAttribute("data-item-id");
  const subtaskId = target.getAttribute("data-subtask-id");

  if (field === "subtask-minutes") {
    updateSubtaskMinutes(itemId, subtaskId, target.value);
  }
});

itemDetail.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".subtask-editor-row");
  const input = event.target.closest(".draggable-subtask");
  if (!row || !input) {
    return;
  }

  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setDragImage(row, 24, 24);
  event.dataTransfer.setData(
    "text/plain",
    JSON.stringify({
      itemId: input.getAttribute("data-item-id"),
      subtaskId: input.getAttribute("data-subtask-id"),
    })
  );
});

itemDetail.addEventListener("dragend", (event) => {
  const row = event.target.closest(".subtask-editor-row");
  if (row) {
    row.classList.remove("dragging");
  }
  itemDetail.querySelectorAll(".subtask-editor-row").forEach((entry) => {
    entry.classList.remove("drop-target");
  });
});

itemDetail.addEventListener("dragover", (event) => {
  const row = event.target.closest(".subtask-editor-row");
  if (!row) {
    return;
  }

  event.preventDefault();
  itemDetail.querySelectorAll(".subtask-editor-row").forEach((entry) => {
    entry.classList.remove("drop-target");
  });
  row.classList.add("drop-target");
});

itemDetail.addEventListener("drop", (event) => {
  const row = event.target.closest(".subtask-editor-row");
  if (!row) {
    return;
  }

  event.preventDefault();

  const payload = event.dataTransfer.getData("text/plain");
  if (!payload) {
    return;
  }

  const { itemId, subtaskId } = JSON.parse(payload);
  const targetSubtaskId = row.querySelector("[data-subtask-id]")?.getAttribute("data-subtask-id");
  const item = items.find((entry) => entry.id === itemId);
  if (!item || !targetSubtaskId) {
    return;
  }

  const targetIndex = item.subtasks.findIndex((subtask) => subtask.id === targetSubtaskId);
  moveSubtaskToIndex(itemId, subtaskId, targetIndex);
});

createSubtaskRow();
renderMinutePicker();
renderItemsBoard();
hydrateFromSupabase();
