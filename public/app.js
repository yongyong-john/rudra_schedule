const STORAGE_KEY = "plaync-party-builder:v1";

const PRODUCT_OPTIONS = [
  { value: "aion2", label: "AION2" }
];

const elements = {
  addGroupBtn: document.getElementById("addGroupBtn"),
  assignmentSummary: document.getElementById("assignmentSummary"),
  clearResultsBtn: document.getElementById("clearResultsBtn"),
  groupsContainer: document.getElementById("groupsContainer"),
  keywordInput: document.getElementById("keywordInput"),
  productSelect: document.getElementById("productSelect"),
  resultsCount: document.getElementById("resultsCount"),
  resultsList: document.getElementById("resultsList"),
  resultsReleaseZone: document.getElementById("resultsReleaseZone"),
  searchButton: document.getElementById("searchButton"),
  searchForm: document.getElementById("searchForm"),
  searchStatus: document.getElementById("searchStatus"),
  serverInput: document.getElementById("serverInput"),
  toast: document.getElementById("toast")
};

const state = hydrateState();
let toastTimer = null;

syncForm();
bindEvents();
render();

function hydrateState() {
  const fallback = {
    nextGroupId: 2,
    groups: [createGroup(1)],
    results: [],
    settings: {
      keyword: "",
      product: "aion2",
      server: ""
    },
    ui: {
      searchMeta: null,
      searchLoading: false
    }
  };

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored);
    const groups = Array.isArray(parsed.groups) && parsed.groups.length
      ? parsed.groups.map(normalizeGroup).filter(Boolean)
      : [createGroup(1)];

    return {
      nextGroupId: Number.isInteger(parsed.nextGroupId) ? parsed.nextGroupId : groups.length + 1,
      groups,
      results: Array.isArray(parsed.results) ? parsed.results.map(normalizeCharacter).filter(Boolean) : [],
      settings: {
        keyword: typeof parsed.settings?.keyword === "string" ? parsed.settings.keyword : "",
        product: PRODUCT_OPTIONS.some((option) => option.value === parsed.settings?.product)
          ? parsed.settings.product
          : "aion2",
        server: typeof parsed.settings?.server === "string" ? parsed.settings.server : ""
      },
      ui: {
        searchMeta: parsed.ui?.searchMeta ?? null,
        searchLoading: false
      }
    };
  } catch (error) {
    return fallback;
  }
}

function normalizeGroup(group) {
  if (!group || !Array.isArray(group.parties)) {
    return null;
  }

  const parties = group.parties.slice(0, 2).map((party) => {
    if (!Array.isArray(party)) {
      return [];
    }

    return party.slice(0, 4).map(normalizeCharacter).filter(Boolean);
  });

  while (parties.length < 2) {
    parties.push([]);
  }

  return {
    id: Number.isInteger(group.id) ? group.id : Date.now(),
    parties
  };
}

function normalizeCharacter(character) {
  if (!character || typeof character !== "object") {
    return null;
  }

  const name = typeof character.name === "string" ? character.name.trim() : "";
  if (!name) {
    return null;
  }

  const product = PRODUCT_OPTIONS.some((option) => option.value === character.product)
    ? character.product
    : "aion2";

  const serverKey = [character.serverId, character.serverName, character.worldName]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);

  return {
    id: typeof character.id === "string" && character.id.trim()
      ? character.id.trim()
      : [product, serverKey || "all", name].join(":"),
    product,
    name,
    className: typeof character.className === "string" && character.className.trim()
      ? character.className.trim()
      : "미확인",
    combatPower: normalizePower(character.combatPower),
    powerLabel: typeof character.powerLabel === "string" && character.powerLabel.trim()
      ? character.powerLabel.trim()
      : "전투력",
    serverId: typeof character.serverId === "string" ? character.serverId.trim() : "",
    serverName: typeof character.serverName === "string" ? character.serverName.trim() : "",
    worldName: typeof character.worldName === "string" ? character.worldName.trim() : ""
  };
}

function normalizePower(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function createGroup(id) {
  return {
    id,
    parties: [[], []]
  };
}

function syncForm() {
  elements.keywordInput.value = state.settings.keyword;
  elements.productSelect.value = state.settings.product;
  elements.serverInput.value = state.settings.server;
}

function bindEvents() {
  elements.addGroupBtn.addEventListener("click", () => {
    state.groups.push(createGroup(state.nextGroupId));
    state.nextGroupId += 1;
    persistState();
    render();
    showToast("새 그룹이 추가되었습니다.");
  });

  elements.clearResultsBtn.addEventListener("click", () => {
    state.results = [];
    state.ui.searchMeta = null;
    persistState();
    render();
    showToast("검색 결과를 비웠습니다.");
  });

  elements.searchForm.addEventListener("submit", handleSearchSubmit);

  elements.resultsReleaseZone.addEventListener("dragover", handleDragOver);
  elements.resultsReleaseZone.addEventListener("dragleave", handleDragLeave);
  elements.resultsReleaseZone.addEventListener("drop", handleDropToReleaseZone);
}

async function handleSearchSubmit(event) {
  event.preventDefault();

  const keyword = elements.keywordInput.value.trim();
  const product = elements.productSelect.value;
  const server = elements.serverInput.value.trim();

  if (!keyword) {
    showToast("캐릭터명을 입력해 주세요.", "warn");
    elements.keywordInput.focus();
    return;
  }

  state.settings.keyword = keyword;
  state.settings.product = product;
  state.settings.server = server;
  state.ui.searchLoading = true;
  state.ui.searchMeta = null;
  render();

  const params = new URLSearchParams({
    action: "search",
    keyword,
    product
  });

  if (server) {
    params.set("server", server);
  }

  try {
    const response = await fetch(`/.netlify/functions/plaync-character?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "캐릭터 검색에 실패했습니다.");
    }

    const characters = Array.isArray(payload.characters)
      ? payload.characters.map(normalizeCharacter).filter(Boolean)
      : [];

    state.results = mergeCharacters(state.results, characters, true);
    syncAssignedCardsWithResults(characters);
    state.ui.searchMeta = payload.meta ?? null;
    state.ui.searchLoading = false;
    persistState();
    render();

    const successMessage = characters.length
      ? `${characters.length}명의 캐릭터를 불러왔습니다.`
      : "검색 결과가 없습니다.";
    showToast(successMessage);
  } catch (error) {
    state.ui.searchLoading = false;
    render();
    showToast(error.message || "캐릭터 검색 중 오류가 발생했습니다.", "error");
  }
}

function render() {
  renderSummary();
  renderGroups();
  renderResults();
  renderSearchStatus();
  syncForm();
}

function renderSummary() {
  const assignedCount = flattenAssignedCharacters().length;
  const capacity = state.groups.length * 8;
  elements.assignmentSummary.textContent = `${assignedCount} / ${capacity} 배치`;
  elements.resultsCount.textContent = `검색 결과 ${state.results.length}명`;
  elements.searchButton.disabled = state.ui.searchLoading;
  elements.searchButton.textContent = state.ui.searchLoading ? "검색 중..." : "검색";
}

function renderGroups() {
  elements.groupsContainer.innerHTML = "";

  state.groups.forEach((group, groupIndex) => {
    const groupCard = document.createElement("section");
    groupCard.className = "group-card";

    const assignedCount = group.parties[0].length + group.parties[1].length;
    const groupHead = document.createElement("div");
    groupHead.className = "group-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "group-title-wrap";
    titleWrap.innerHTML = `
      <h3>${groupIndex + 1}그룹</h3>
      <p>총 ${assignedCount}명 배치 · 최대 8명</p>
    `;

    const actions = document.createElement("div");
    actions.className = "group-actions";

    if (state.groups.length > 1) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-ghost";
      removeButton.textContent = "그룹 삭제";
      removeButton.addEventListener("click", () => removeGroup(group.id));
      actions.appendChild(removeButton);
    }

    groupHead.append(titleWrap, actions);

    const grid = document.createElement("div");
    grid.className = "group-grid";

    group.parties.forEach((party, partyIndex) => {
      const partyCard = document.createElement("article");
      partyCard.className = "party-card";

      const partyHead = document.createElement("div");
      partyHead.className = "party-head";
      partyHead.innerHTML = `
        <h4>${partyIndex + 1}파티</h4>
        <span>${party.length} / 4</span>
      `;

      const partyList = document.createElement("div");
      partyList.className = "party-list";

      if (!party.length) {
        partyList.appendChild(createEmptyDropZone(group.id, partyIndex));
      } else {
        party.forEach((character, index) => {
          partyList.appendChild(createPartyCharacterCard(character, group.id, partyIndex, index));
        });
        partyList.appendChild(createEndDropZone(group.id, partyIndex, party.length));
      }

      const placeholders = document.createElement("div");
      placeholders.className = "slot-placeholders";
      for (let slot = party.length; slot < 4; slot += 1) {
        const placeholder = document.createElement("div");
        placeholder.className = "slot-placeholder";
        placeholders.appendChild(placeholder);
      }

      partyCard.append(partyHead, partyList, placeholders);
      grid.appendChild(partyCard);
    });

    groupCard.append(groupHead, grid);
    elements.groupsContainer.appendChild(groupCard);
  });
}

function renderResults() {
  elements.resultsList.innerHTML = "";

  if (!state.results.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = `
      <div>
        아직 불러온 캐릭터가 없습니다.<br />
        하단 검색으로 AION2 캐릭터를 먼저 가져오세요.
      </div>
    `;
    elements.resultsList.appendChild(emptyState);
    return;
  }

  state.results.forEach((character) => {
    elements.resultsList.appendChild(createResultCharacterCard(character));
  });
}

function renderSearchStatus() {
  if (state.ui.searchLoading) {
    elements.searchStatus.textContent = "AION2 공식 검색/랭킹 API에서 캐릭터를 조회하는 중입니다.";
    return;
  }

  if (state.ui.searchMeta?.searchPath) {
    const metricLabel = state.ui.searchMeta.displayMetric || "전투력";
    elements.searchStatus.textContent =
      `마지막 조회: AION2 공식 검색 API (${state.ui.searchMeta.searchPath}) · 표시 지표: ${metricLabel}`;
    return;
  }

  elements.searchStatus.textContent = "AION2 서버와 캐릭터명을 입력한 뒤 검색하세요.";
}

function createResultCharacterCard(character) {
  const location = findCharacterPlacement(character.id);
  const card = createCharacterCard(character, {
    compact: false,
    source: {
      type: "results",
      characterId: character.id
    }
  });

  if (location) {
    const chip = document.createElement("div");
    chip.className = "assignment-chip";
    chip.textContent = `${location.groupNumber}그룹 ${location.partyNumber}파티 배치됨`;
    card.appendChild(chip);
    card.classList.add("is-assigned");
  }

  return card;
}

function createPartyCharacterCard(character, groupId, partyIndex, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "drop-target";

  wrapper.addEventListener("dragover", handleDragOver);
  wrapper.addEventListener("dragleave", handleDragLeave);
  wrapper.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, index);
  });

  const card = createCharacterCard(character, {
    compact: true,
    source: {
      type: "party",
      characterId: character.id,
      groupId,
      partyIndex,
      index
    }
  });

  wrapper.appendChild(card);
  return wrapper;
}

function createEndDropZone(groupId, partyIndex, insertIndex) {
  const zone = document.createElement("div");
  zone.className = "drop-target drop-target-end";
  zone.textContent = "여기로 드롭해 파티 끝에 추가";
  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, insertIndex);
  });
  return zone;
}

function createEmptyDropZone(groupId, partyIndex) {
  const zone = document.createElement("div");
  zone.className = "drop-target drop-target-empty";
  zone.innerHTML = `
    <div class="drop-copy">
      검색 결과 또는 다른 파티의 캐릭터를<br />
      여기로 드래그하세요.
    </div>
  `;
  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, 0);
  });
  return zone;
}

function createCharacterCard(character, options) {
  const card = document.createElement("article");
  card.className = `character-card${options.compact ? " is-compact" : ""}`;
  card.draggable = true;

  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(options.source));
  });

  const top = document.createElement("div");
  top.className = "character-top";

  const titleWrap = document.createElement("div");
  const name = document.createElement("p");
  name.className = "character-name";
  name.textContent = character.name;

  const sub = document.createElement("div");
  sub.className = "character-sub";
  const serverLabel = [character.worldName, character.serverName].filter(Boolean).join(" · ");
  sub.textContent = serverLabel || "서버 정보 없음";

  titleWrap.append(name, sub);

  const game = document.createElement("span");
  game.className = "character-game";
  game.textContent = getProductLabel(character.product);

  top.append(titleWrap, game);

  const meta = document.createElement("div");
  meta.className = "character-meta";

  const className = document.createElement("div");
  className.className = "character-class";
  className.textContent = character.className || "미확인";

  const power = document.createElement("div");
  power.className = "power-block";
  power.innerHTML = `
    <span class="power-label">${character.powerLabel || "전투력"}</span>
    <strong class="power-value">${formatPower(character.combatPower)}</strong>
  `;

  meta.append(className, power);

  card.append(top, meta);
  return card;
}

function moveCharacterToParty(payload, targetGroupId, targetPartyIndex, insertIndex) {
  const character = resolveCharacter(payload);
  if (!character) {
    showToast("이동할 캐릭터 정보를 찾지 못했습니다.", "error");
    return;
  }

  const placement = findCharacterPlacement(character.id);
  const targetGroup = state.groups.find((group) => group.id === targetGroupId);
  const targetParty = targetGroup?.parties[targetPartyIndex];

  if (!targetParty) {
    return;
  }

  const sameParty = placement
    && placement.groupId === targetGroupId
    && placement.partyIndex === targetPartyIndex;

  if (!sameParty && targetParty.length >= 4) {
    showToast("한 파티에는 최대 4명까지만 배치할 수 있습니다.", "warn");
    return;
  }

  removeCharacterFromGroups(character.id);

  let safeIndex = Math.max(0, Math.min(insertIndex, targetParty.length));
  if (sameParty && placement.index < insertIndex) {
    safeIndex -= 1;
  }

  targetParty.splice(safeIndex, 0, character);
  persistState();
  render();

  const groupNumber = state.groups.findIndex((group) => group.id === targetGroupId) + 1;
  showToast(`${character.name}을 ${groupNumber}그룹 ${targetPartyIndex + 1}파티로 이동했습니다.`);
}

function handleDropToReleaseZone(event) {
  handleDragLeave(event);
  const payload = readDragPayload(event);
  if (!payload || payload.type !== "party") {
    return;
  }

  const character = removeCharacterFromGroups(payload.characterId);
  if (!character) {
    return;
  }

  state.results = mergeCharacters(state.results, [character], false);
  persistState();
  render();
  showToast(`${character.name}의 파티 배치를 해제했습니다.`);
}

function resolveCharacter(payload) {
  if (payload.type === "results") {
    return cloneCharacter(state.results.find((character) => character.id === payload.characterId));
  }

  if (payload.type === "party") {
    const placement = findCharacterPlacement(payload.characterId);
    if (!placement) {
      return null;
    }

    return cloneCharacter(state.groups[placement.groupIndex].parties[placement.partyIndex][placement.index]);
  }

  return null;
}

function removeCharacterFromGroups(characterId) {
  for (const group of state.groups) {
    for (const party of group.parties) {
      const index = party.findIndex((character) => character.id === characterId);
      if (index !== -1) {
        return party.splice(index, 1)[0];
      }
    }
  }
  return null;
}

function removeGroup(groupId) {
  const groupIndex = state.groups.findIndex((group) => group.id === groupId);
  if (groupIndex === -1) {
    return;
  }

  const group = state.groups[groupIndex];
  const characterCount = group.parties[0].length + group.parties[1].length;
  const message = characterCount
    ? "이 그룹을 삭제하면 배치된 캐릭터는 검색 결과 목록으로 돌아갑니다. 계속할까요?"
    : "이 그룹을 삭제할까요?";

  if (!window.confirm(message)) {
    return;
  }

  state.results = mergeCharacters(state.results, flattenGroupCharacters(group), false);
  state.groups.splice(groupIndex, 1);
  persistState();
  render();
  showToast("그룹을 삭제했습니다.");
}

function mergeCharacters(existingCharacters, incomingCharacters, replace) {
  const nextMap = new Map();

  if (!replace) {
    existingCharacters.forEach((character) => {
      nextMap.set(character.id, cloneCharacter(character));
    });
  }

  incomingCharacters.forEach((character) => {
    const normalized = normalizeCharacter(character);
    if (!normalized) {
      return;
    }

    const previous = nextMap.get(normalized.id);
    nextMap.set(normalized.id, {
      ...previous,
      ...normalized
    });
  });

  return Array.from(nextMap.values()).sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function syncAssignedCardsWithResults(results) {
  const resultMap = new Map(results.map((character) => [character.id, character]));

  state.groups.forEach((group) => {
    group.parties.forEach((party, partyIndex) => {
      group.parties[partyIndex] = party.map((character) => {
        const synced = resultMap.get(character.id);
        return synced ? { ...character, ...synced } : character;
      });
    });
  });
}

function findCharacterPlacement(characterId) {
  for (let groupIndex = 0; groupIndex < state.groups.length; groupIndex += 1) {
    const group = state.groups[groupIndex];
    for (let partyIndex = 0; partyIndex < group.parties.length; partyIndex += 1) {
      const party = group.parties[partyIndex];
      const index = party.findIndex((character) => character.id === characterId);
      if (index !== -1) {
        return {
          groupId: group.id,
          groupIndex,
          groupNumber: groupIndex + 1,
          index,
          partyIndex,
          partyNumber: partyIndex + 1
        };
      }
    }
  }

  return null;
}

function flattenAssignedCharacters() {
  return state.groups.flatMap((group) => flattenGroupCharacters(group));
}

function flattenGroupCharacters(group) {
  return group.parties.flatMap((party) => party.map(cloneCharacter));
}

function cloneCharacter(character) {
  return character ? { ...character } : null;
}

function persistState() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      nextGroupId: state.nextGroupId,
      groups: state.groups,
      results: state.results,
      settings: state.settings,
      ui: {
        searchMeta: state.ui.searchMeta
      }
    })
  );
}

function formatPower(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "미확인";
  }

  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

function getProductLabel(product) {
  return PRODUCT_OPTIONS.find((option) => option.value === product)?.label ?? product.toUpperCase();
}

function readDragPayload(event) {
  event.preventDefault();
  try {
    const raw = event.dataTransfer.getData("text/plain");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("is-over");
  event.dataTransfer.dropEffect = "move";
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove("is-over");
}

function showToast(message, tone = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2200);
}
