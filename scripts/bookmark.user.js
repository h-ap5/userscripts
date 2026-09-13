// ==UserScript==
// @name         크랙 버블 북마크 🔖
// @namespace    https://crack.wrtn.ai/
// @version      1.0.0
// @description  버블별 색상, 턴 방향 탐색, 입력창 테두리 고정, 유저 버블 ON/OFF, 좌우반전, 3줄 미리보기
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';
    if (document.getElementById('cbb-panel')) return;

    // 사이트 구조가 바뀌면 이 선택자부터 확인하세요. API/인증 정보는 사용하지 않습니다.
    const BODY = '.wrtn-markdown, .markdown-body, [data-message-content], [data-message-group-id] .prose';
    const GROUP = '[data-message-group-id], [data-message-id]';
    const INPUT = '.__chat_input_textarea, .ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea';
    const OWN = '[data-cbb-ui]';
    const CMU_UI = '#cmu-settings-panel, #cmu-toolbar-wrapper, #cmu-log-capture-bar, #cmu-log-capture-preview, #cmu-message-select-copy, .cmu-message-badge, .cmu-user-badge-row, .cac-answer-cost, .cmi-model-slot, #cmu-input-counter-wrap';
    const BLOCKERS = '[role="dialog"], [role="menu"], #sgb-bg-settings-modal, #chud-side-menu, #chud-settings-menu, #chud-info-menu, #hlp-popup, #cmu-settings-panel.open, #cmu-log-capture-bar, #cmu-log-capture-preview.open, #cmu-message-select-copy';
    const POPUPS = `${CMU_UI}, [role="dialog"], [role="menu"], #hlp-popup, #chud-sidebar, #chud-infobar, #chud-side-menu, #chud-settings-menu, #chud-info-menu, #igx-live-popup, #sgb-bg-settings-modal, [id^="novcap-"], .csp-generated-scene-image, .crack-ext-ai-modal, #trans-setting-panel, #trans-result-modal`;
    const EXCLUDED = `${OWN}, [contenteditable="true"], textarea, ${POPUPS}, .not-wrtn-markdown, .trans-live-content`;
    // CSP 원본의 추천 답변은 main button > .wrtn-markdown이며 메시지 그룹 밖에 있다.
    // 제목/메뉴에서도 같은 마크다운 클래스가 쓰이므로 클래스만으로 버블을 판정하지 않는다.
    const NON_MESSAGE = 'button, a, [role="button"], [role="link"], [data-sgb-suggestion-button], header, nav, aside, [role="banner"], [role="navigation"], h1, h2, h3, h4, h5, h6, [role="heading"]';
    const USER_SURFACE = '[data-sgb-bubble], [data-cmu-theme-bubble], .bg-surface_chat_secondary, div.relative.mb-5.items-end, div[class*="border-y"][class*="py-5"]';
    const SEARCH_SURFACE = '[data-sgb-bubble], [data-cmu-theme-bubble], div[class*="bg-surface_chat"], div[class*="break-all"]';
    const PLAIN_SEARCH_SURFACE = '[data-sgb-bubble], [data-cmu-theme-bubble], div[class*="bg-surface_chat"]';
    const PREFIX = 'CrackBubbleBookmarks_v1:';
    const APPEARANCE_KEY = 'CrackBubbleBookmarks_Appearance_v1';
    const MAX_SEARCH_MS = 90000;
    const MAX_SEARCH_STEPS = 100;
    const HIGHLIGHT = 'mark.custom-hlp, mark[data-hlp-id]';
    const PALETTE = [['차콜', '#374047'], ['민트', '#367c68'], ['로즈', '#b65371'], ['머스터드', '#987029'], ['블루', '#4a72a6'], ['라일락', '#856496']];
    const validColor = color => /^#[\da-f]{6}$/i.test(color || '');
    const BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/></svg>';
    // 참고 이미지의 접힌 윗면 + V자 꼬리를 직접 그린 벡터. 외부 이미지 요청 없음.
    const RIBBON = '<svg viewBox="0 0 36 48" aria-hidden="true"><g class="cbb-ribbon-shape"><path d="M27 2h2c4 0 5 4 5 9h-9Z" fill="currentColor"/><path d="M27 2h2c4 0 5 4 5 9h-9Z" fill="#000" opacity=".32"/><path d="M8 2h21c-4 0-5 4-5 9v34L14 37 3 45V11c0-6 1-9 5-9Z" fill="currentColor"/><path d="M8 2h21c-3 0-4 2-5 5H4c1-4 2-5 4-5Z" fill="#fff" opacity=".2"/></g><path class="cbb-check" d="m8 21 4 4 8-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 3-.5 3-2.5 1.5-3-.5-1 3 2.5 2v3L2 17l2 3 3-1 2 1 .5 3h4l.5-3 2-1 3 1 2-3-2.5-2v-3L21 10l-1-3-3 .5L14.5 6 14 3Z" transform="translate(1 -1) scale(.92)"/><circle cx="12" cy="12" r="3"/></svg>';
    const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/></svg>';
    const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';

    const css = `
    [data-cbb-ui] {
        --cbb-bg: #fafbf9; --cbb-card: #f0f3ef; --cbb-text: #202922;
        --cbb-muted: #59655c; --cbb-border: #d7dfd8; --cbb-primary: #246649;
        --cbb-accent: #e0eee4; --cbb-danger: #b02f36;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 14px; line-height: 1.6; color: var(--cbb-text); box-sizing: border-box; color-scheme: light;
    }
    [data-cbb-ui][data-cbb-dark="true"] {
        --cbb-bg: #202623; --cbb-card: #2a332d; --cbb-text: #ecf2ed;
        --cbb-muted: #b2bfb5; --cbb-border: #435248; --cbb-primary: #a0d8b5;
        --cbb-accent: #334c3d; --cbb-danger: #ffadb0; color-scheme: dark;
    }
    [data-cbb-ui] *, [data-cbb-ui] *::before, [data-cbb-ui] *::after { box-sizing: border-box; }
    [data-cbb-ui][hidden], [data-cbb-ui] [hidden] { display: none !important; }
    [data-cbb-ui] button, button[data-cbb-ui] {
        appearance: none; display: inline-flex; align-items: center; justify-content: center;
        gap: 8px; min-height: 32px; padding: 4px 8px; margin: 0;
        border: 1px solid transparent; border-radius: 8px; background: transparent;
        color: inherit; font: inherit; cursor: pointer; touch-action: manipulation;
        transition: background 140ms, color 140ms;
    }
    [data-cbb-ui] button:hover, button[data-cbb-ui]:hover { background: var(--cbb-accent); color: var(--cbb-primary); }
    [data-cbb-ui] button:active, button[data-cbb-ui]:active { background: var(--cbb-border); }
    [data-cbb-ui] button:disabled { opacity: .5; cursor: wait; }
    [data-cbb-ui] :focus-visible, button[data-cbb-ui]:focus-visible { outline: 2px solid var(--cbb-primary); outline-offset: 2px; }
    [data-cbb-ui] svg { width: 18px; height: 18px; flex-shrink: 0; pointer-events: none; }
    #cbb-overlay-root { position: fixed !important; inset: 0 !important; z-index: 40 !important; pointer-events: none !important; overflow: visible !important; contain: layout style; }
    #cbb-overlay-root .cbb-ribbon { position: absolute !important; width: 44px !important; height: 48px !important; min-height: 48px !important; margin: 0 !important; padding: 2px 4px !important; border: 0 !important; border-radius: 4px !important; background: transparent !important; color: var(--cbb-ribbon-color, #374047) !important; pointer-events: auto; touch-action: pan-y; cursor: pointer; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    #cbb-overlay-root .cbb-ribbon svg { width: 32px; height: 44px; transform: translateX(4px); filter: drop-shadow(0 2px 2px #0003); opacity: .62; transition: opacity 140ms; }
    #cbb-overlay-root .cbb-ribbon:hover svg, #cbb-overlay-root .cbb-ribbon:focus-visible svg, #cbb-overlay-root .cbb-ribbon[aria-pressed="true"] svg, #cbb-toolbar svg { opacity: 1; }
    #cbb-overlay-root .cbb-bubble-ribbon, #cbb-overlay-root .cbb-bubble-ribbon:active { cursor: pointer; touch-action: pan-y; }
    #cbb-overlay-root[data-cbb-mirror="true"] .cbb-ribbon-shape { transform: translateX(36px) scaleX(-1); }
    #cbb-overlay-root[data-cbb-mirror="true"] .cbb-check { transform: translateX(8px); }
    #cbb-overlay-root .cbb-check { display: none; }
    #cbb-overlay-root [aria-pressed="true"] .cbb-check { display: block; }
    #cbb-toolbar[data-has-items="true"]::after { content: ''; position: absolute; width: 6px; height: 6px; border: 1px solid var(--cbb-bg); border-radius: 50%; right: 8px; top: 9px; background: var(--cbb-primary); pointer-events: none; }
    #cbb-panel { position: fixed; z-index: 2147483602; width: 376px; max-width: calc(100vw - 16px); display: flex; flex-direction: column; overflow: hidden; background: var(--cbb-bg); border: 1px solid var(--cbb-border); border-radius: 16px; box-shadow: 0 16px 48px #0003; }
    #cbb-panel header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 16px; border-bottom: 1px solid var(--cbb-border); flex-shrink: 0; cursor: grab; touch-action: none; }
    #cbb-panel header:active { cursor: grabbing; }
    #cbb-panel .cbb-header-buttons { display: flex; gap: 4px; }
    #cbb-panel h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.03em; line-height: 1.2; }
    .cbb-subtitle { color: var(--cbb-muted); font-size: 14px; margin-top: 4px; }
    #cbb-panel .cbb-search-area { padding: 16px 16px 8px; }
    #cbb-panel label { display: block; color: var(--cbb-muted); margin-bottom: 4px; font-size: 14px; }
    #cbb-panel input { appearance: none; width: 100%; height: 40px; margin: 0; padding: 8px; border: 1px solid var(--cbb-border); border-radius: 8px; background: var(--cbb-bg); color: var(--cbb-text); font: inherit; font-size: 16px; }
    #cbb-panel input:focus { border-color: var(--cbb-primary); }
    #cbb-panel input::placeholder { color: var(--cbb-muted); opacity: 1; }
    #cbb-settings { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px; }
    #cbb-settings h3 { font-size: 16px; margin: 0 0 8px; line-height: 1.3; }
    #cbb-settings p { margin: 8px 0 16px; font-size: 14px; color: var(--cbb-muted); }
    #cbb-settings .cbb-colors { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 16px; }
    #cbb-settings .cbb-color { width: 40px; height: 40px; min-height: 40px; padding: 4px; border: 1px solid var(--cbb-border); background: var(--swatch); }
    #cbb-settings .cbb-color[aria-pressed="true"] { outline: 2px solid var(--cbb-primary); outline-offset: 2px; }
    #cbb-settings .cbb-custom-color { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    #cbb-settings input[type="color"] { width: 48px; padding: 4px; flex-shrink: 0; cursor: pointer; }
    #cbb-settings .cbb-reset { border: 1px solid var(--cbb-border); }
    #cbb-settings .cbb-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 48px; margin: 8px 0; padding: 8px; border: 1px solid var(--cbb-border); text-align: left; }
    #cbb-settings .cbb-toggle::after { content: 'OFF'; flex-shrink: 0; color: var(--cbb-muted); }
    #cbb-settings .cbb-toggle[aria-checked="true"]::after { content: 'ON'; color: var(--cbb-primary); font-weight: 700; }
    #cbb-list { overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 8px 16px 16px; }
    #cbb-list .cbb-item { border: 1px solid var(--cbb-border); border-left: 4px solid var(--cbb-item-color, var(--cbb-border)); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
    #cbb-list .cbb-record-color-toggle::before { content: ''; width: 16px; height: 16px; border-radius: 50%; background: var(--cbb-item-color); border: 1px solid var(--cbb-border); }
    #cbb-list .cbb-record-palette { padding: 8px 16px 16px; display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--cbb-border); }
    #cbb-list .cbb-record-palette button[data-record-color] { width: 40px; min-height: 40px; background: var(--swatch); border: 1px solid var(--cbb-border); }
    #cbb-list .cbb-record-palette button[aria-pressed="true"] { outline: 2px solid var(--cbb-primary); outline-offset: 2px; }
    #cbb-list .cbb-record-palette label { width: 100%; margin: 0; }
    #cbb-list .cbb-record-palette input[type="color"] { width: 48px; padding: 4px; }
    #cbb-navigation-preview { position: fixed !important; z-index: 41 !important; overflow: hidden !important; padding: 0 !important; margin: 0 !important; contain: strict; touch-action: none; cursor: progress; }
    #cbb-list .cbb-jump { display: block; width: 100%; text-align: left; padding: 16px 16px 8px; border: 0; border-radius: 0; }
    #cbb-list .cbb-item-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    #cbb-list .cbb-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 650; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #cbb-list .cbb-turn { flex-shrink: 0; color: var(--cbb-primary); font-size: 14px; font-variant-numeric: tabular-nums; }
    #cbb-list .cbb-preview { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; max-height: 4.8em; color: var(--cbb-muted); }
    #cbb-list .cbb-item-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px 16px; }
    #cbb-list .cbb-item-bottom > div { display: flex; align-items: center; flex-shrink: 0; }
    #cbb-list .cbb-open-label { color: var(--cbb-muted); font-size: 14px; white-space: nowrap; }
    #cbb-list .cbb-delete { color: var(--cbb-danger); }
    #cbb-list .cbb-edit-form { padding: 8px 16px 16px; background: var(--cbb-card); }
    #cbb-list .cbb-edit-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    #cbb-list .cbb-save { background: var(--cbb-accent); color: var(--cbb-primary); }
    .cbb-empty { padding: 24px 8px; color: var(--cbb-muted); text-align: center; white-space: pre-line; }
    #cbb-panel footer { padding: 8px 16px; border-top: 1px solid var(--cbb-border); color: var(--cbb-muted); font-size: 14px; flex-shrink: 0; }
    #cbb-notice { position: fixed; left: 50%; transform: translateX(-50%); bottom: max(24px, env(safe-area-inset-bottom)); z-index: 2147483604; max-width: calc(100vw - 32px); width: max-content; padding: 8px 16px; background: var(--cbb-bg); border: 1px solid var(--cbb-border); border-radius: 8px; box-shadow: 0 8px 24px #0002; display: flex; align-items: center; gap: 8px; }
    #cbb-notice span { white-space: pre-line; }
    .cbb-found { outline: 3px solid #57a779 !important; outline-offset: 4px; border-radius: 8px; }
    @media (pointer: coarse) { #cbb-panel button { min-height: 44px; } }
    @media (prefers-reduced-motion: reduce) { [data-cbb-ui] *, button[data-cbb-ui] { transition: none !important; } }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function own(node) { node.setAttribute('data-cbb-ui', ''); return node; }
    function button(label, icon, action) {
        const node = el('button'); node.type = 'button'; node.title = label;
        node.setAttribute('aria-label', label);
        if (icon) node.innerHTML = icon; // 아이콘은 위에 선언한 상수만 사용.
        else node.textContent = label;
        node.addEventListener('pointerdown', e => e.stopPropagation());
        node.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if ((suppressClicks.get(node) || 0) < performance.now()) action(e); });
        return node;
    }
    function roomPath() {
        const path = location.pathname;
        return path.match(/^\/stories\/[^/]+\/episodes\/[^/]+/)?.[0]
            || path.match(/^\/(?:episodes|chats?)\/[a-zA-Z0-9_-]{8,}/)?.[0] || '';
    }
    const normal = text => String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const textKey = text => normal(text).normalize('NFC').replace(/\s/g, '');
    function wholeTextRelated(saved, current) {
        if (!saved || !current) return false;
        return current.includes(saved)
            || (current.length >= 40 && saved.includes(current) && current.length / saved.length >= .72);
    }
    const key = () => PREFIX + currentRoom;
    let currentRoom = roomPath(), records = [], bodies = [], editingId = null, dirty = true;
    let scanTimer = 0, frame = 0, noticeTimer = 0, navigation = null, dark = false;
    let undo = null, colorEditingId = null, lastLocation = null, navigationView = null;
    const ribbons = new Map(), suppressClicks = new WeakMap();
    let appearance = readAppearance(), composerInput = null, composerAnchor = null;
    const overlay = own(el('div')); overlay.id = 'cbb-overlay-root';

    const toolbar = own(button('버블 북마크 열기 · 입력창 우측 상단 고정', RIBBON, () => setOpen(panel.hidden)));
    toolbar.className = 'cbb-ribbon'; toolbar.dataset.cbbKind = 'composer';
    toolbar.id = 'cbb-toolbar'; toolbar.setAttribute('aria-haspopup', 'dialog');
    toolbar.setAttribute('aria-controls', 'cbb-panel'); toolbar.setAttribute('aria-expanded', 'false');
    const panel = own(el('section')); panel.id = 'cbb-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '이 채팅방의 버블 북마크'); panel.tabIndex = -1;
    const header = el('header'), heading = el('div'), subtitle = el('div', 'cbb-subtitle');
    heading.append(el('h2', '', '버블 북마크'), subtitle);
    const headerButtons = el('div', 'cbb-header-buttons');
    const appearanceButton = button('책갈피 색상·위치 설정', GEAR, () => showSettings(settingsPane.hidden));
    headerButtons.append(appearanceButton, button('북마크 닫기', CROSS, () => setOpen(false, true)));
    header.append(heading, headerButtons);
    const searchArea = el('div', 'cbb-search-area'), searchLabel = el('label', '', '북마크 검색');
    const search = el('input'); search.type = 'search'; search.id = 'cbb-search'; search.placeholder = '제목 또는 대화 내용';
    searchLabel.htmlFor = search.id; searchArea.append(searchLabel, search);
    const list = el('div'); list.id = 'cbb-list';
    const settingsPane = el('div'); settingsPane.id = 'cbb-settings'; settingsPane.hidden = true;
    const footer = el('footer', '', '버블 우측 위 책갈피를 눌러 저장');
    panel.append(header, searchArea, list, settingsPane, footer);
    const notice = own(el('div')); notice.id = 'cbb-notice'; notice.hidden = true;
    const noticeText = el('span'); noticeText.setAttribute('role', 'status'); noticeText.setAttribute('aria-live', 'polite');
    const noticeAction = button('닫기', '', () => { notice.hidden = true; });
    notice.append(noticeText, noticeAction);
    overlay.append(toolbar); document.body.append(overlay, panel, notice);
    buildSettings(); applyAppearance();
    attachFixedTap(toolbar); attachDrag(header, () => 'panel');

    function defaultPlacement() { return { panel: null }; }
    function defaultAppearance() { return { color: '#374047', showUser: true, mirror: false, desktop: defaultPlacement(), mobile: defaultPlacement() }; }
    function deviceKey() { return innerWidth <= 640 || matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop'; }
    function readAppearance() {
        const defaults = defaultAppearance();
        try {
            const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null');
            if (/^#[\da-f]{6}$/i.test(raw?.color)) defaults.color = raw.color;
            for (const key of ['showUser', 'mirror']) if (typeof raw?.[key] === 'boolean') defaults[key] = raw[key];
            for (const device of ['desktop', 'mobile']) {
                const point = raw?.[device]?.panel;
                if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) defaults[device].panel = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
            }
        } catch { /* 표시 설정 오류는 북마크 내용과 무관하게 기본값으로 복구 */ }
        return defaults;
    }
    function saveAppearance() {
        try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); }
        catch { toast('책갈피 설정을 저장하지 못했어요. 현재 화면에만 적용됩니다.'); }
    }
    function applyAppearance() {
        overlay.style.setProperty('--cbb-ribbon-color', appearance.color);
        overlay.dataset.cbbMirror = String(appearance.mirror);
        settingsPane.querySelectorAll('[data-setting]').forEach(node => node.setAttribute('aria-checked', String(appearance[node.dataset.setting])));
        settingsPane.querySelectorAll('[data-color]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.color === appearance.color)));
        const picker = settingsPane.querySelector('input[type="color"]'); if (picker) picker.value = appearance.color;
        schedulePosition(); scheduleScan();
    }
    function showSettings(show) {
        settingsPane.hidden = !show; searchArea.hidden = show; list.hidden = show;
        appearanceButton.setAttribute('aria-pressed', String(show));
        appearanceButton.title = show ? '북마크 목록으로 돌아가기' : '책갈피 색상·위치 설정';
        footer.textContent = show ? '설정은 이 브라우저에 저장됩니다.' : '버블 우측 위 책갈피를 눌러 저장';
        if (!show) renderList(); position();
    }
    function buildSettings() {
        settingsPane.append(el('h3', '', '표시 설정'));
        for (const [key, label] of [['showUser', '유저 입력 버블 책갈피'], ['mirror', '책갈피 아이콘 좌우반전']]) {
            const toggle = button(label, '', () => { appearance[key] = !appearance[key]; applyAppearance(); saveAppearance(); });
            toggle.className = 'cbb-toggle'; toggle.dataset.setting = key; toggle.setAttribute('role', 'switch'); settingsPane.append(toggle);
        }
        settingsPane.append(el('p', '', '유저 버블을 OFF로 해도 저장한 북마크와 원문 이동은 유지돼요. 좌우반전은 버블·입력창 아이콘에 함께 적용돼요.'));
        settingsPane.append(el('h3', '', '입력창 · 새 책갈피 기본 색상'), el('p', '', '저장한 책갈피의 색은 목록에서 각 항목의 색상 버튼으로 바꿔요. 기본 색상을 바꿔도 기존 책갈피 색은 유지됩니다.'));
        const colors = el('div', 'cbb-colors');
        for (const [label, color] of PALETTE) {
            const swatch = button(label, '', () => { appearance.color = color; applyAppearance(); saveAppearance(); });
            swatch.textContent = ''; swatch.className = 'cbb-color'; swatch.dataset.color = color; swatch.style.setProperty('--swatch', color); colors.append(swatch);
        }
        const custom = el('div', 'cbb-custom-color'), label = el('label', '', '직접 고르기'); label.htmlFor = 'cbb-color-picker';
        const picker = el('input'); picker.type = 'color'; picker.id = label.htmlFor;
        picker.addEventListener('input', () => { appearance.color = picker.value; applyAppearance(); });
        picker.addEventListener('change', saveAppearance); custom.append(label, picker);
        settingsPane.append(colors, custom, el('h3', '', '책갈피 위치 고정'), el('p', '', '입력창 책갈피는 입력 박스 위 테두리에 붙어요. 정보바 전체를 피해 위로 떠오르지 않고, 테두리의 빈 자리에 걸칩니다. 드래그로 움직이지 않아요.'));
        const reset = button('색상·위치 초기화', '', () => { const { showUser, mirror } = appearance; appearance = { ...defaultAppearance(), showUser, mirror }; applyAppearance(); position(); saveAppearance(); }); reset.className = 'cbb-reset';
        settingsPane.append(el('p', '', '열린 설정창은 위쪽 제목 부분을 잡고 이동할 수 있어요. 책갈피는 버블과 입력창을 계속 따라갑니다.'), reset);
    }
    function attachDrag(node, getKind) {
        let gesture = null;
        node.addEventListener('pointerdown', event => {
            if (event.button !== 0 || (node === header && event.target.closest('button, input, select'))) return;
            const kind = getKind(), device = deviceKey(); if (!kind) return;
            const rect = (kind === 'panel' ? panel : node).getBoundingClientRect();
            gesture = { id: event.pointerId, kind, device, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top,
                old: appearance[device][kind] ? { ...appearance[device][kind] } : null, moved: false };
            node.setPointerCapture(event.pointerId); event.stopPropagation();
        });
        node.addEventListener('pointermove', event => {
            if (!gesture || gesture.id !== event.pointerId) return;
            const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
            if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
            gesture.moved = true; event.preventDefault(); event.stopPropagation();
            if (gesture.kind === 'panel') {
                const view = viewport(), rect = panel.getBoundingClientRect();
                appearance[gesture.device].panel = { x: Math.max(0, Math.min(1, (gesture.left + dx - view.left - 8) / Math.max(1, view.width - rect.width - 16))), y: Math.max(0, Math.min(1, (gesture.top + dy - view.top - 8) / Math.max(1, view.height - rect.height - 16))) };
            }
            position();
        });
        function finish(event) {
            if (!gesture || gesture.id !== event.pointerId) return;
            if (gesture.moved) {
                suppressClicks.set(node, performance.now() + 700);
                if (event.type === 'pointercancel') { appearance[gesture.device][gesture.kind] = gesture.old; position(); }
                else saveAppearance();
            }
            if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
            gesture = null;
        }
        node.addEventListener('pointerup', finish); node.addEventListener('pointercancel', finish);
        node.addEventListener('lostpointercapture', () => { if (gesture?.moved) { suppressClicks.set(node, performance.now() + 700); saveAppearance(); } gesture = null; });
        node.addEventListener('contextmenu', event => event.preventDefault());
    }
    function attachFixedTap(node) {
        // 스와이프/길게 누르기를 저장/설정 열기 탭으로 오인하지 않음. 리본은 모두 위치 고정.
        let start = null;
        node.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY, at: performance.now() }; });
        const moved = event => start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6;
        node.addEventListener('pointermove', event => { if (moved(event)) suppressClicks.set(node, performance.now() + 700); });
        node.addEventListener('pointerup', event => {
            if (moved(event) || (start && performance.now() - start.at > 650)) suppressClicks.set(node, performance.now() + 700);
            start = null;
        });
        node.addEventListener('pointercancel', () => { start = null; suppressClicks.set(node, performance.now() + 700); });
        node.addEventListener('contextmenu', event => { event.preventDefault(); suppressClicks.set(node, performance.now() + 700); });
    }

    function toast(message, label, action, persistent = false) {
        clearTimeout(noticeTimer); notice.hidden = false; noticeText.textContent = message;
        noticeAction.textContent = label || '닫기'; noticeAction.title = label || '닫기';
        noticeAction.setAttribute('aria-label', label || '닫기');
        noticeAction.onclick = e => { e.preventDefault(); e.stopPropagation(); notice.hidden = true; action?.(); };
        if (!persistent) noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
    }
    function readRecords() {
        const raw = localStorage.getItem(key());
        if (raw === null) return [];
        const data = JSON.parse(raw);
        if (!data || data.version !== 1 || !Array.isArray(data.items)) throw new Error('invalid storage');
        if (!data.items.every(r => r && typeof r.id === 'string' && typeof r.text === 'string' && typeof r.title === 'string')) throw new Error('invalid record');
        return data.items;
    }
    function loadRecords() {
        try {
            records = currentRoom ? readRecords() : [];
            if (records.some(record => !validColor(record.color) || (!record.turn && headerTurn(record.text)))) {
                records = records.map(record => ({ ...record, color: validColor(record.color) ? record.color : appearance.color, turn: record.turn || headerTurn(record.text) }));
                try { localStorage.setItem(key(), JSON.stringify({ version: 1, items: records })); }
                catch { toast('기존 책갈피 표시 정보를 저장하지 못했어요. 현재 화면에는 적용했습니다.'); }
            }
        }
        catch { records = []; toast('북마크 데이터를 읽지 못했어요. 기존 데이터는 덮어쓰지 않습니다.', null, null, true); }
        updateCount();
    }
    // 매번 최신 목록을 읽어 다른 탭에서 수정한 북마크를 보존. 쓰기 실패 시 화면도 저장 전 상태 유지.
    function changeRecords(change) {
        if (!currentRoom || roomPath() !== currentRoom) return false;
        try {
            const updated = change(readRecords());
            localStorage.setItem(key(), JSON.stringify({ version: 1, items: updated }));
            records = updated; updateCount(); renderList(); refreshButtons(); return true;
        } catch {
            toast('저장하지 못했어요. 브라우저 저장 공간이나 기존 북마크 데이터를 확인해 주세요.', null, null, true);
            return false;
        }
    }
    function updateCount() {
        subtitle.textContent = `이 채팅방 · ${records.length}개`;
        toolbar.dataset.hasItems = String(records.length > 0);
        toolbar.title = `버블 북마크 ${records.length}개`;
    }

    function visible(node) {
        return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0
            && getComputedStyle(node).visibility !== 'hidden';
    }
    function isMessageBody(node) {
        const group = node.closest('[data-message-group-id]') || node.closest('[data-message-id]');
        return !!group && !!(group.getAttribute('data-message-group-id') || group.getAttribute('data-message-id') || '').trim()
            && !node.closest(`${EXCLUDED}, ${NON_MESSAGE}`) && visible(node);
    }
    function isPlainUserBody(node) {
        if (!isMessageBody(node) || roleFor(node) !== 'user') return false;
        const group = node.closest(GROUP), surface = node.closest(USER_SURFACE);
        // break-all / whitespace-pre-wrap 은 이름에도 붙는다. 확인된 유저 말풍선 안에서만 보조 본문으로 허용.
        return !!surface && surface !== group && group.contains(surface);
    }
    function isSearchBody(node) {
        if (node.closest(`${EXCLUDED}, ${NON_MESSAGE}`) || !visible(node)) return false;
        // 과거 로그 로딩 중 ID가 아직 붙지 않은 실제 말풍선도 읽는다. 표시할 리본의 판정은 계속 엄격하게 유지.
        return isMessageBody(node) || !!node.closest(SEARCH_SURFACE);
    }
    function collectBodies(forSearch = false) {
        const root = document.querySelector('main') || document.body;
        const selector = forSearch ? `${BODY}, .prose, [class*="wrtn-markdown"]` : BODY;
        const candidates = [...root.querySelectorAll(selector)].filter(node => (forSearch ? isSearchBody(node) : isMessageBody(node)) && !node.parentElement?.closest(selector));
        // 마크다운이 없는 유저 말풍선만 보조 수집. 프로필 이름/제목에는 이 경로를 적용하지 않음.
        root.querySelectorAll(`${GROUP}`).forEach(group => {
            group.querySelectorAll('[class*="whitespace-pre-wrap"], [class*="break-all"]').forEach(node => {
                if (!isPlainUserBody(node) || node.querySelector(BODY) || node.closest(BODY)) return;
                if (candidates.some(body => body.contains(node) || node.contains(body))) return;
                if (normal(node.textContent)) candidates.push(node);
            });
        });
        if (forSearch) root.querySelectorAll(PLAIN_SEARCH_SURFACE).forEach(node => {
            if (!isSearchBody(node) || node.querySelector(selector) || node.closest(selector) || !normal(node.textContent)) return;
            if (!candidates.some(body => body.contains(node) || node.contains(body))) candidates.push(node);
        });
        return candidates.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    }
    function bodyText(body, legacy = false) {
        // DOM을 매번 복제하지 않고 텍스트만 읽는다. 형광펜 mark의 버튼 역할은 본문으로 보존.
        const chunks = [];
        const visit = node => {
            if (node.nodeType === 3) { chunks.push(node.nodeValue); return; }
            if (node.nodeType !== 1) return;
            if (node !== body && (node.matches(`${OWN}, ${CMU_UI}, button, script, style, textarea, [aria-hidden="true"]`)
                || (node.getAttribute('role') === 'button' && (legacy || !node.matches(HIGHLIGHT))))) return;
            if (node.tagName === 'BR') { chunks.push('\n'); return; }
            if (node.tagName === 'IMG') { chunks.push(`[이미지${node.alt ? ': ' + node.alt : ''}]`); return; }
            node.childNodes.forEach(visit);
            if (node !== body && /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-4]|TR)$/.test(node.tagName)) chunks.push('\n');
        };
        visit(body);
        return chunks.join('').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function parseTurn(value) {
        const match = normal(value).match(/^(?:[\[【(]\s*)?(?:(?:턴(?:수)?|turn)\s*[:#：-]?\s*(\d[\d,]*)|#?\s*(\d[\d,]*)\s*(?:번째\s*)?(?:턴|turn))(?:\s*[\]】)])?$/i);
        return match ? String(Number((match[1] || match[2]).replace(/,/g, ''))) : '';
    }
    function headerTurn(text) {
        const header = normal(text).match(/^[\[【]\s*#(\d[\d,]*)\s*[|｜]/);
        return header ? String(Number(header[1].replace(/,/g, ''))) : '';
    }
    function roleFor(body) {
        const group = body.closest(GROUP);
        for (let node = body; node; node = node.parentElement) {
            const role = (node.getAttribute('data-message-role') || node.getAttribute('data-role') || '').toLowerCase();
            if (['user', 'human'].includes(role)) return 'user';
            if (['assistant', 'ai', 'bot'].includes(role)) return 'assistant';
            if (node === group || node === document.body) break;
        }
        // CMU 4.2.4가 사용하는 실제 크랙 유저 말풍선/소설형 입력 구조. 본문 문자열로 역할을 추측하지 않음.
        const wrap = body.closest('div.relative.mb-5.items-end, div[class*="border-y"][class*="py-5"], .bg-surface_chat_secondary');
        if (wrap && group?.contains(wrap)) return 'user';
        if (group?.querySelector('.cmu-user-badge-row')) return 'user';
        return '';
    }
    function turnFor(body, group) {
        for (let node = body; node; node = node.parentElement) {
            for (const name of ['data-turn-number', 'data-turn']) {
                const value = node.getAttribute(name);
                if (value && /^\d+$/.test(value.trim())) return String(Number(value));
            }
            if (node === group || node === document.body) break;
        }
        // 헤더/상태창의 독립된 '12턴' 또는 '턴: 12'만 인식. 일반 문장 속 숫자나 DOM 순서는 추측하지 않음.
        const scope = group || body.parentElement || body;
        for (const node of scope.querySelectorAll('[data-turn-number], [data-turn], [data-turn-label], .turn-number, span, small, p, div')) {
            if (node.closest(`${OWN}, ${CMU_UI}`) || !visible(node) || (node.children.length && !node.matches('[data-turn-label], .turn-number'))) continue;
            if (node.closest(BODY) && !body.contains(node)) continue;
            const parsed = parseTurn(node.getAttribute('aria-label') || node.textContent);
            if (parsed) return parsed;
        }
        return headerTurn(body.querySelector('p')?.textContent || body.textContent);
    }
    function resolve(record, descriptions) {
        let pool = descriptions;
        if (record.messageId) pool = pool.filter(d => d.messageId === record.messageId);
        else if (record.groupId) pool = pool.filter(d => d.groupId === record.groupId);
        // 보기 전환 후 개별 ID 속성이 사라져도 같은 그룹의 전체 본문으로 재확인.
        if (!pool.length && record.messageId && record.groupId) pool = descriptions.filter(d => d.groupId === record.groupId);
        if (record.role) pool = pool.filter(d => !d.role || d.role === record.role);
        let exact = pool.filter(d => textKey(d.text) === textKey(record.text));
        // 1.2.0까지 형광펜 부분이 빠져 저장된 항목: 같은 식별자 안에서 당시 추출 결과를 재현.
        // 같은 그룹의 다른 리롤을 고르지 않도록 임의 부분 일치/슬롯 번호만으로 연결하지 않는다.
        if (!exact.length && record.textVersion !== 2 && (record.messageId || record.groupId) && textKey(record.text)) {
            exact = pool.filter(d => d.body.querySelector(HIGHLIGHT) && textKey(bodyText(d.body, true)) === textKey(record.text));
        }
        if (exact.length === 1) return { match: exact[0] };
        if (exact.length > 1) {
            // 안정적인 그룹 안의 같은 문장만 슬롯 번호로 구별. 전체 DOM 인덱스는 저장하지 않음.
            if (record.messageId || record.groupId) {
                const indexed = exact.filter(d => d.bodyIndex === record.bodyIndex);
                if (indexed.length === 1) return { match: indexed[0] };
            }
            const contextual = exact.filter(d => (record.turn && d.turn === record.turn)
                || (record.before && d.before === record.before) || (record.after && d.after === record.after));
            return contextual.length === 1 ? { match: contextual[0] } : { ambiguous: true };
        }
        // 개별 메시지 ID가 유일한 경우에는 본문 수정 후에도 같은 버블로 이동 가능.
        // 그룹 ID만 같고 내용이 바뀐 리롤 답변은 다른 로그로 취급.
        if (record.messageId && pool.length === 1 && pool[0].messageId === record.messageId && !pool[0].multipleParts && record.singleMessage) return { match: pool[0] };
        // 저장한 전체 문장이 그대로 있고 앞뒤에 표시 정보만 늘어난 경우도 같은 그룹에서 확인.
        // 짧은 일부 대사나 단어 유사도로 다른 답변을 추측하지 않는다.
        const savedText = textKey(record.text);
        if (savedText.length >= 40) {
            const compatible = d => (!record.role || !d.role || d.role === record.role) && (!record.turn || !d.turn || record.turn === d.turn);
            const related = (pool.length ? pool : descriptions).filter(compatible);
            const contained = related.filter(d => wholeTextRelated(savedText, textKey(d.text)));
            if (contained.length === 1) return { match: contained[0] };
            if (contained.length > 1) return { ambiguous: true };
        }
        // 렌더링 과정에서 ID가 바뀌어도 긴 전체 본문이 유일하게 일치하면 바로 연결한다.
        // 짧은 반복 대사나 턴수가 다른 항목에는 이 보조 규칙을 쓰지 않는다.
        if (!pool.length && textKey(record.text).length >= 40) {
            const textMatches = descriptions.filter(d => textKey(d.text) === textKey(record.text)
                && (!record.role || !d.role || d.role === record.role) && (!record.turn || !d.turn || record.turn === d.turn));
            if (textMatches.length === 1) return { match: textMatches[0] };
            if (textMatches.length > 1) return { ambiguous: true };
        }
        return {};
    }
    function descriptions(source = bodies) {
        const families = new Map();
        const all = source.map(body => {
            const group = body.closest('[data-message-group-id]'), message = body.closest('[data-message-id]');
            const family = message || group || body, parts = families.get(family) || [];
            const data = { body, text: bodyText(body),
                groupId: group?.getAttribute('data-message-group-id') || '', messageId: message?.getAttribute('data-message-id') || '',
                bodyIndex: parts.length, turn: turnFor(body, group || message),
                role: roleFor(body), family };
            parts.push(data); families.set(family, parts); return data;
        });
        return all.map((data, index) => {
            const { family, ...rest } = data;
            return { ...rest, multipleParts: !!data.messageId && families.get(family).length > 1,
                before: index > 0 ? normal(all[index - 1].text).slice(0, 160) : '',
                after: index < all.length - 1 ? normal(all[index + 1].text).slice(0, 160) : '' };
        });
    }
    function looseSearchBodies(record, existing = []) {
        const saved = textKey(record.text);
        if (saved.length < 40) return [];
        const root = document.querySelector('main') || document.body;
        const selector = '[data-message-group-id] [class*="break-all"], [data-message-id] [class*="break-all"], '
            + '[data-message-group-id] [class*="whitespace-pre-wrap"], [data-message-id] [class*="whitespace-pre-wrap"]';
        const matches = [...root.querySelectorAll(selector)].filter(node => {
            if (!isSearchBody(node) || existing.includes(node)) return false;
            return wholeTextRelated(saved, textKey(bodyText(node)));
        });
        // 바깥 래퍼와 실제 본문이 함께 맞으면 더 안쪽의 실제 본문만 사용한다.
        return matches.filter(node => !matches.some(other => other !== node && node.contains(other)));
    }
    function refreshButtons() {
        const all = descriptions();
        const savedBodies = new Map();
        records.forEach(record => { const result = resolve(record, all); if (result.match) savedBodies.set(result.match.body, record); });
        bodies.forEach(body => {
            const btn = ribbons.get(body)?.button;
            if (!btn) return;
            const record = savedBodies.get(body);
            // 가상 목록이 도착 직후 DOM을 교체해도 같은 원문에 남은 강조 시간을 이어준다.
            if (record && lastLocation && record.id === lastLocation.id && lastLocation.room === currentRoom) markTarget(body, lastLocation.until);
            const data = all.find(d => d.body === body);
            btn.dataset.cbbGroup = data?.groupId || data?.messageId || '';
            btn.dataset.cbbIndex = String(data?.bodyIndex || 0);
            btn.setAttribute('aria-pressed', String(!!record));
            if (record) btn.style.setProperty('--cbb-ribbon-color', validColor(record.color) ? record.color : appearance.color);
            else btn.style.removeProperty('--cbb-ribbon-color');
            btn.setAttribute('aria-label', record ? '이 버블 북마크 해제' : '이 버블 북마크');
            btn.title = (record ? '북마크 해제' : '이 버블 북마크') + ' · 버블 우측 위 고정';
        });
    }
    function toggleBookmark(body) {
        if (roomPath() !== currentRoom || !currentRoom || !body.isConnected) return;
        if (!appearance.showUser && roleFor(body) === 'user') return;
        bodies = collectBodies();
        const all = descriptions();
        const existing = records.find(record => resolve(record, all).match?.body === body);
        if (existing) { removeRecord(existing.id); return; }
        const description = all.find(d => d.body === body);
        if (!description || !normal(description.text)) { toast('저장할 대화 내용을 찾지 못했어요.'); return; }
        const { body: ignored, multipleParts, ...data } = description;
        const record = { ...data, textVersion: 2, color: appearance.color, singleMessage: !!data.messageId && !multipleParts,
            id: crypto.randomUUID(), title: normal(data.text).slice(0, 40), createdAt: Date.now() };
        if (changeRecords(items => {
            if (items.some(item => resolve(item, all).match?.body === body)) return items;
            return [...items, record];
        })) toast('버블을 북마크했어요.', '제목 수정', () => { setOpen(true); startEdit(record.id); });
    }
    function removeRecord(id) {
        const removed = records.find(item => item.id === id); if (!removed) return;
        const fromRoom = currentRoom;
        if (changeRecords(items => items.filter(item => item.id !== id))) {
            undo = { removed, fromRoom };
            toast('북마크를 해제했어요.', '되돌리기', () => {
                if (!undo || currentRoom !== undo.fromRoom) return;
                const item = undo.removed;
                changeRecords(items => items.some(r => r.id === item.id) ? items : [...items, item]); undo = null;
            });
        }
    }
    function startEdit(id) { editingId = id; renderList(); const input = list.querySelector('.cbb-edit-form input'); input?.focus(); input?.select(); }
    function setRecordColor(id, color) {
        if (!validColor(color)) return;
        changeRecords(items => items.map(record => record.id === id ? { ...record, color } : record));
    }
    function renderList() {
        if (panel.hidden) return;
        const scroll = list.scrollTop, query = normal(search.value).toLocaleLowerCase();
        list.replaceChildren();
        const filtered = records.filter(r => `${r.title} ${r.text} ${r.turn || ''}턴`.toLocaleLowerCase().includes(query)).sort((a, b) => b.createdAt - a.createdAt);
        if (!filtered.length) list.append(el('div', 'cbb-empty', query ? '검색 결과가 없어요.' : '다시 읽고 싶은 대화를 모아보세요.\n버블 우측 위 책갈피를 누르면\n이곳에 3줄 미리보기로 쌓여요.'));
        filtered.forEach(record => {
            const item = el('article', 'cbb-item'); item.dataset.bookmarkId = record.id;
            item.style.setProperty('--cbb-item-color', validColor(record.color) ? record.color : appearance.color);
            const jump = button(`${record.title}${record.turn ? `, ${record.turn}턴` : ''}, 원문으로 이동`, '', () => jumpTo(record));
            jump.className = 'cbb-jump'; jump.replaceChildren();
            const top = el('span', 'cbb-item-header'); top.append(el('span', 'cbb-title', record.title));
            if (record.turn) top.append(el('span', 'cbb-turn', `${record.turn}턴`));
            jump.append(top, el('span', 'cbb-preview', record.text));
            const bottom = el('div', 'cbb-item-bottom'), actions = el('div');
            const edit = button('북마크 제목 수정', PEN, () => startEdit(record.id));
            const remove = button('북마크 삭제', TRASH, () => removeRecord(record.id)); remove.className = 'cbb-delete';
            const colorButton = button('이 북마크 색상 변경', '', () => { colorEditingId = colorEditingId === record.id ? null : record.id; renderList(); });
            colorButton.className = 'cbb-record-color-toggle'; colorButton.textContent = ''; colorButton.setAttribute('aria-expanded', String(colorEditingId === record.id));
            const openLink = button('원문으로 이동', '', () => jumpTo(record));
            openLink.className = 'cbb-open-label'; openLink.textContent = '원문 이동 ↗';
            actions.append(colorButton, edit, remove); bottom.append(openLink, actions);
            item.append(jump, bottom);
            if (colorEditingId === record.id) {
                const palette = el('div', 'cbb-record-palette'); palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', '이 북마크 색상');
                for (const [name, color] of PALETTE) {
                    const swatch = button(name, '', () => setRecordColor(record.id, color)); swatch.textContent = ''; swatch.dataset.recordColor = color;
                    swatch.style.setProperty('--swatch', color); swatch.setAttribute('aria-pressed', String(record.color === color)); palette.append(swatch);
                }
                const label = el('label', '', '직접 고르기'), picker = el('input'); picker.type = 'color'; picker.id = `cbb-record-color-${record.id}`; label.htmlFor = picker.id;
                picker.value = validColor(record.color) ? record.color : appearance.color; picker.addEventListener('change', () => setRecordColor(record.id, picker.value));
                palette.append(label, picker, button('색상 닫기', '', () => { colorEditingId = null; renderList(); })); item.append(palette);
            }
            if (editingId === record.id) {
                const form = el('form', 'cbb-edit-form'), label = el('label', '', '북마크 제목'), input = el('input');
                input.id = 'cbb-edit-title'; input.value = record.title; input.maxLength = 100; label.htmlFor = input.id;
                const buttons = el('div', 'cbb-edit-buttons');
                const save = () => {
                    const title = input.value.trim() || normal(record.text).slice(0, 40) || '제목 없는 북마크';
                    if (changeRecords(items => items.map(r => r.id === record.id ? { ...r, title } : r))) {
                        editingId = null; renderList(); list.querySelector(`[data-bookmark-id="${CSS.escape(record.id)}"] .cbb-jump`)?.focus();
                    }
                };
                const saveButton = button('저장', '', save); saveButton.className = 'cbb-save';
                buttons.append(button('취소', '', () => { editingId = null; renderList(); }), saveButton);
                form.append(label, input, buttons); form.addEventListener('submit', e => { e.preventDefault(); save(); });
                input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); editingId = null; renderList(); } });
                item.append(form);
            }
            list.append(item);
        });
        list.scrollTop = scroll; position();
    }
    function setOpen(open, focusBack = false) {
        if (open && (!currentRoom || roomPath() !== currentRoom)) return;
        panel.hidden = !open; toolbar.setAttribute('aria-expanded', String(open));
        if (open) { showSettings(false); loadRecords(); renderList(); position(); panel.focus({ preventScroll: true }); }
        else { editingId = null; colorEditingId = null; if (focusBack && toolbar.isConnected) toolbar.focus({ preventScroll: true }); }
    }
    search.addEventListener('input', () => { editingId = null; renderList(); });
    document.addEventListener('pointerdown', e => {
        if (!panel.hidden && !panel.contains(e.target) && !toolbar.contains(e.target) && !notice.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (navigation) { cancelNavigation(); toast('원문 찾기를 중단했어요.'); }
            if (!panel.hidden) { e.preventDefault(); setOpen(false, true); }
        }
    });

    function findInput() {
        return [...document.querySelectorAll(INPUT)].filter(node => !node.closest(`${OWN}, ${POPUPS}, ${GROUP}, .bg-surface_tertiary`) && visible(node))
            .sort((a, b) => (Number(b.matches('.__chat_input_textarea')) - Number(a.matches('.__chat_input_textarea'))) * 10000 + b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
    }
    function inputSurface(input) {
        if (!input) return null;
        return input.closest('[data-sgb-input-box], [data-cmu-theme-input-box]')
            || input.closest('div[class*="rounded-lg"][class*="border"]')
            || input.closest('div[class*="rounded"][class*="border"]') || input;
    }
    function bubbleSurface(body) {
        const group = body.closest(GROUP);
        const surface = body.closest('[data-sgb-bubble], [data-cmu-theme-bubble], div[class*="break-all"], div[class*="bg-surface_chat"], div[class*="rounded"][class*="px-"]');
        if (!surface || (group && !group.contains(surface))) return body;
        // 한 표면에 독립된 본문이 여러 개면 각 본문 모서리에 연결.
        return [...surface.querySelectorAll(BODY)].filter(node => isMessageBody(node) && !node.parentElement?.closest(BODY)).length > 1 ? body : surface;
    }
    function bubbleKind(surface) {
        const explicit = surface.getAttribute('data-sgb-bubble') || surface.getAttribute('data-cmu-theme-bubble');
        if (explicit === 'novel' || explicit === 'chat') return explicit;
        const cls = String(surface.className), style = String(surface.getAttribute('style') || '').replace(/\s/g, '');
        return /rounded-none|bg-transparent/.test(cls) || (/px-0/.test(cls) && /py-0/.test(cls))
            || /background(?:-color)?:transparent|border-radius:0|padding:12px0/.test(style)
            || !!surface.closest('[data-sgb-novel-group], [data-cmu-theme-novel-group]') ? 'novel' : 'chat';
    }
    function mountToolbar() {
        const input = findInput(), anchor = inputSurface(input);
        if (composerInput !== input || composerAnchor !== anchor) {
            if (composerInput) resizeObserver.unobserve(composerInput);
            if (composerAnchor) resizeObserver.unobserve(composerAnchor);
            composerInput = input; composerAnchor = anchor;
            if (input) resizeObserver.observe(input);
            if (anchor) resizeObserver.observe(anchor);
        }
        if (toolbar.parentElement !== overlay) overlay.append(toolbar);
        toolbar.hidden = !anchor;
        position();
    }
    function viewport() {
        const v = window.visualViewport;
        return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0, width: v?.width || innerWidth, height: v?.height || innerHeight };
    }
    function position() {
        if (roomPath() !== currentRoom) { overlay.hidden = true; toolbar.hidden = true; panel.hidden = true; scheduleScan(); return; }
        if (!currentRoom) return;
        const view = viewport();
        const blocked = document.documentElement.matches('.cmu-panel-open, .cmu-user-note-open, .cmu-mobile-room-panel-open')
            || [...document.querySelectorAll(BLOCKERS)].some(node => !node.closest(OWN) && visible(node));
        overlay.hidden = blocked;
        if (blocked && !panel.hidden) setOpen(false);
        if (blocked && navigationView) cancelNavigation();
        if (navigationView) { overlay.hidden = true; return; }
        const inputRect = composerAnchor?.isConnected ? composerAnchor.getBoundingClientRect() : null;
        if (!blocked) {
            const inputScope = composerAnchor?.closest('[data-sgb-input-host], [data-cmu-theme-input-host], form') || composerAnchor?.parentElement;
            // 정보바의 투명한 전체 폭은 장애물이 아니다. 실제 입력 테두리 안의 글자/버튼만 피한다.
            const obstacles = [...inputScope?.querySelectorAll('button, [role="button"], #chud-sidebar span, #chud-infobar span, #cmu-input-counter-wrap') || []]
                .filter(node => !node.closest('#igx-live-popup, #cdcg-root'))
                .filter(node => !node.closest(OWN) && visible(node)).map(node => {
                    const r = node.getBoundingClientRect(), clip = clipRect(node, view);
                    return { left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) };
                }).filter(r => r.right > r.left && r.bottom > r.top && inputRect && r.bottom > inputRect.top && r.top < inputRect.bottom);
            if (composerAnchor?.isConnected) placeRibbon(toolbar, composerAnchor, 'composer', view, obstacles);
            else toolbar.hidden = true;
            ribbons.forEach((info, body) => {
                if (!body.isConnected || (!appearance.showUser && roleFor(body) === 'user')) { info.button.hidden = true; return; }
                const surface = bubbleSurface(body), kind = bubbleKind(surface);
                if (info.surface !== surface) { if (info.surface) resizeObserver.unobserve(info.surface); resizeObserver.observe(surface); info.surface = surface; }
                info.kind = kind; info.button.dataset.cbbKind = kind;
                const rect = surface.getBoundingClientRect();
                if (rect.top < view.top - 50 || rect.top > view.top + view.height) { info.button.hidden = true; return; }
                const group = body.closest(GROUP);
                const metadata = [...group?.querySelectorAll('button, [role="button"], [data-turn-label], .turn-number, .cmu-message-badge, .cac-answer-cost, .cmi-model-slot, small, span') || []]
                    .filter(node => !node.closest(`${OWN}, ${BODY}`) && visible(node) && (node.matches('button, [role="button"], .cmu-message-badge, .cac-answer-cost, .cmi-model-slot') || parseTurn(node.textContent)))
                    .map(node => node.getBoundingClientRect());
                placeRibbon(info.button, surface, kind, view, [...metadata, ...inputRect ? [inputRect] : []]);
            });
        }
        if (panel.hidden) return;
        const anchor = toolbar.getBoundingClientRect();
        const width = Math.min(376, view.width - 16);
        const above = anchor.top - view.top - 16, below = view.top + view.height - anchor.bottom - 16;
        const up = above >= 260 || above >= below;
        const pinned = appearance[deviceKey()].panel;
        const space = pinned || view.height < 600 ? Math.min(560, view.height - 16) : Math.max(240, Math.min(560, (up ? above : below), view.height - 16));
        panel.style.width = `${width}px`; panel.style.maxHeight = `${Math.min(space, view.height - 16)}px`;
        panel.style.left = `${pinned ? view.left + 8 + Math.max(0, view.width - width - 16) * pinned.x : Math.max(view.left + 8, Math.min(anchor.right - width, view.left + view.width - width - 8))}px`;
        const height = panel.getBoundingClientRect().height;
        panel.style.top = `${pinned ? view.top + 8 + Math.max(0, view.height - height - 16) * pinned.y : Math.max(view.top + 8, Math.min(up ? anchor.top - height - 8 : anchor.bottom + 8, view.top + view.height - height - 8))}px`;
    }
    function clipRect(anchor, view) {
        const clip = { left: view.left, top: view.top, right: view.left + view.width, bottom: view.top + view.height };
        for (let node = anchor.parentElement; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node), rect = node.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clip.left = Math.max(clip.left, rect.left); clip.right = Math.min(clip.right, rect.right); }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clip.top = Math.max(clip.top, rect.top); clip.bottom = Math.min(clip.bottom, rect.bottom); }
        }
        return clip;
    }
    function placeRibbon(node, anchor, kind, view, obstacles) {
        const rect = anchor.getBoundingClientRect();
        if (rect.top < view.top - 50 || rect.top > view.top + view.height || !rect.width || !rect.height) { node.hidden = true; return; }
        const clip = clipRect(anchor, view);
        if (!rect.width || !rect.height || rect.top < clip.top - 2 || rect.top >= clip.bottom - 8 || rect.right <= clip.left || rect.left >= clip.right || !visible(anchor)) { node.hidden = true; return; }
        const composer = kind === 'composer';
        const inset = Math.max(64, Math.min(96, rect.width * .15));
        const base = { left: rect.right - inset - 22, top: rect.top - (kind === 'novel' ? 46 : 10) };
        // 우측 위 안쪽의 같은 앵커 사용. 모든 구버전 리본 드래그 좌표는 무시.
        let left = Math.max(view.left + 2, Math.min(base.left, view.left + view.width - 46));
        let top = Math.max(view.top + 2, Math.min(base.top, view.top + view.height - 50));
        const collides = (x, y) => obstacles.some(o => x + 44 > o.left && x < o.right && y + 48 > o.top && y < o.bottom);
        if (collides(left, top)) {
            // 버블 리본은 주변 UI가 나타나도 다른 위치로 튀지 않음. 겹칠 때만 잠깐 숨김.
            if (!composer) { node.hidden = true; return; }
            // 높이는 입력 박스 테두리에 고정. 라디오존데/가드 위로 밀어 올리지 않는다.
            const minLeft = Math.max(view.left + 2, rect.left + rect.width * .35), maxLeft = Math.min(rect.right - 44, view.left + view.width - 46);
            const candidates = [left, maxLeft, ...obstacles.flatMap(o => [o.left - 48, o.right + 4])]
                .filter(x => x >= minLeft && x <= maxLeft).sort((a, b) => Math.abs(a - base.left) - Math.abs(b - base.left));
            left = candidates.find(x => !collides(x, top)) ?? left;
        }
        // 채팅 스크롤러 밖으로 떠다니거나 하단 입력창 위에 남는 리본은 숨김.
        if (kind !== 'composer' && (top + 24 < clip.top || top > clip.bottom - 24)) { node.hidden = true; return; }
        const pxLeft = `${Math.round(left)}px`, pxTop = `${Math.round(top)}px`;
        const clipPath = kind === 'composer' ? 'none' : `inset(${Math.max(0, clip.top - top)}px ${Math.max(0, left + 44 - clip.right)}px ${Math.max(0, top + 48 - clip.bottom)}px ${Math.max(0, clip.left - left)}px)`;
        if (node.style.left !== pxLeft) node.style.left = pxLeft;
        if (node.style.top !== pxTop) node.style.top = pxTop;
        if (node.style.clipPath !== clipPath) node.style.clipPath = clipPath;
        node.hidden = false;
    }
    function schedulePosition() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; position(); }); }
    function syncTheme() {
        const html = document.documentElement, body = document.body;
        const explicit = (html.classList.contains('cmu-theme-active') && html.getAttribute('data-cmu-theme'))
            || html.getAttribute('data-sgb-theme') || body.getAttribute('data-theme') || html.getAttribute('data-theme');
        dark = explicit ? /dark/i.test(explicit) : html.classList.contains('light') || html.classList.contains('cmu-light') ? false
            : html.classList.contains('dark') || html.classList.contains('cmu-dark') || matchMedia('(prefers-color-scheme: dark)').matches;
        document.querySelectorAll(OWN).forEach(node => {
            if (node.dataset.cbbDark !== String(dark)) node.dataset.cbbDark = String(dark);
        });
    }

    // 실제 말풍선의 바깥 조상만 후보로 삼아 설정창/사이드바/말풍선 내부 스크롤을 건드리지 않는다.
    // 크랙은 테마와 모바일 레이아웃에 따라 대화 스크롤 영역이 둘 이상 중첩될 수 있다.
    function conversationScrollers(source) {
        const nodes = Array.isArray(source) ? source : [source];
        const found = [], seen = new Set();
        const add = node => {
            if (!(node instanceof HTMLElement) || seen.has(node) || node.closest(OWN) || !node.clientHeight) return;
            const style = getComputedStyle(node);
            if (!/(auto|scroll|overlay|hidden)/.test(style.overflowY) || node.scrollHeight <= node.clientHeight + 2) return;
            seen.add(node); found.push(node);
        };
        nodes.forEach(body => {
            const group = body?.closest(GROUP);
            for (let node = (group || bubbleSurface(body) || body)?.parentElement; node && node !== document.body; node = node.parentElement) add(node);
        });
        const page = document.scrollingElement;
        if (page && page.scrollHeight > page.clientHeight + 2 && !seen.has(page)) { seen.add(page); found.push(page); }
        return found;
    }
    function scrollParent(body) {
        const candidates = conversationScrollers(body);
        if (candidates.length) return candidates[0];
        // 아직 내용이 짧아 스크롤 범위가 생기지 않은 초기 화면의 대기용 후보.
        const group = body?.closest(GROUP);
        for (let node = (group || bubbleSurface(body) || body)?.parentElement; node && node !== document.body; node = node.parentElement) {
            if (node.clientHeight && /(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
        }
        return document.scrollingElement;
    }
    function isReverse(scroller) { return getComputedStyle(scroller).flexDirection === 'column-reverse'; }
    function scrollRange(scroller) {
        const extent = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        return isReverse(scroller) ? { min: -extent, max: 0 } : { min: 0, max: extent };
    }
    function setScroll(scroller, top) {
        // 사이트의 smooth 지정으로 탐색이 지연되지 않도록 이 스크롤만 즉시 이동.
        scroller.scrollTo({ top, behavior: 'instant' });
    }
    function waitForChange(signal, scroller, ms = 800) {
        return new Promise(resolve => {
            let settle = 0;
            const observer = new MutationObserver(changes => {
                if (!changes.some(change => {
                    const node = change.target.nodeType === 1 ? change.target : change.target.parentElement;
                    return node && !node.closest(OWN);
                })) return;
                clearTimeout(settle); settle = setTimeout(done, 120);
            });
            const timer = setTimeout(done, ms);
            function done() { clearTimeout(timer); clearTimeout(settle); observer.disconnect(); signal.removeEventListener('abort', done); resolve(); }
            if (scroller) observer.observe(scroller, { childList: true, subtree: true, characterData: true });
            signal.addEventListener('abort', done, { once: true });
            if (signal.aborted) done();
        });
    }
    function closeNavigationView(controller, restore) {
        if (navigationView?.controller === controller) { navigationView.end(restore); navigationView = null; }
    }
    function markTarget(body, until) {
        const remaining = until - Date.now();
        if (!(remaining > 0) || body.classList.contains('cbb-found')) return;
        body.classList.add('cbb-found'); setTimeout(() => body.classList.remove('cbb-found'), remaining);
    }
    function cancelNavigation() {
        if (navigation) { const previous = navigation; previous.abort(); closeNavigationView(previous, true); navigation = null; scheduleScan(); }
    }
    function turnDirection(record, all, scroller) {
        const target = Number(record.turn); if (!record.turn || !Number.isFinite(target)) return null;
        const bounds = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
        const numbered = all.filter(d => d.turn && Number.isFinite(Number(d.turn))).map(d => ({ turn: Number(d.turn), rect: d.body.getBoundingClientRect() }));
        const shown = numbered.filter(d => d.rect.bottom > bounds.top && d.rect.top < bounds.bottom).sort((a, b) => a.rect.top - b.rect.top);
        let sign = 1;
        const ordered = numbered.slice().sort((a, b) => a.rect.top - b.rect.top);
        if (ordered.length > 1) {
            const first = ordered[0], last = ordered.find(d => d.turn !== first.turn);
            if (last) sign = Math.sign(last.turn - first.turn) || 1;
        }
        const nearest = numbered.reduce((best, item) => {
            const distance = item.rect.bottom < bounds.top ? bounds.top - item.rect.bottom
                : item.rect.top > bounds.bottom ? item.rect.top - bounds.bottom : 0;
            return !best || distance < best.distance ? { turn: item.turn, distance } : best;
        }, null);
        // 현재 DOM에 실제 턴 정보가 있으면 이전에 방문한 다른 책갈피의 턴보다 우선한다.
        const reference = shown.length ? shown.reduce((a, b) => Math.abs(a.rect.top - bounds.top) < Math.abs(b.rect.top - bounds.top) ? a : b).turn
            : nearest?.turn ?? (lastLocation?.room === currentRoom && lastLocation.turn ? Number(lastLocation.turn) : undefined);
        if (!Number.isFinite(reference) || reference === target) return null;
        return { direction: Math.sign(target - reference) * sign, reference, target, sign };
    }
    function freezeNavigation(scroller, all, controller) {
        const view = viewport(), raw = scroller === document.scrollingElement ? { left: view.left, right: view.left + view.width, top: view.top, bottom: view.top + view.height } : scroller.getBoundingClientRect();
        const area = { left: Math.max(raw.left, view.left), right: Math.min(raw.right, view.left + view.width), top: Math.max(raw.top, view.top), bottom: Math.min(raw.bottom, view.top + view.height) };
        if (area.right <= area.left || area.bottom <= area.top) return;
        const shown = all.filter(d => { const r = d.body.getBoundingClientRect(); return r.bottom > area.top && r.top < area.bottom; });
        const start = shown[0], startTop = start?.body.getBoundingClientRect().top, initialScroll = scroller.scrollTop, fromRoom = currentRoom;
        const cover = own(el('div')); cover.id = 'cbb-navigation-preview'; cover.setAttribute('aria-label', '원문을 찾는 동안 유지되는 대화 화면. 누르면 탐색 중단');
        let background = dark ? '#1d2220' : '#fafbf9';
        for (let n = scroller; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { background = bg; break; } }
        cover.style.cssText = `left:${area.left}px;top:${area.top}px;width:${area.right - area.left}px;height:${area.bottom - area.top}px;background:${background};`;
        const roots = [...new Set(shown.map(d => d.body.closest(GROUP) || bubbleSurface(d.body)))].slice(0, 12);
        const copied = ['display', 'position', 'box-sizing', 'width', 'height', 'padding', 'margin', 'border', 'border-radius', 'background-color', 'color', 'font', 'line-height', 'letter-spacing', 'white-space', 'text-align', 'word-break', 'overflow-wrap', 'flex-direction', 'align-items', 'justify-content', 'gap', 'opacity', 'object-fit'];
        roots.forEach(source => {
            const clone = source.cloneNode(true), originals = [source, ...source.querySelectorAll('*')], clones = [clone, ...clone.querySelectorAll('*')];
            originals.forEach((node, index) => {
                const copy = clones[index], style = getComputedStyle(node);
                copied.forEach(name => copy.style.setProperty(name, style.getPropertyValue(name), 'important'));
                copy.removeAttribute('id'); copy.removeAttribute('data-message-group-id'); copy.removeAttribute('data-message-id');
            });
            clone.querySelectorAll('script, style, iframe, video, audio, object').forEach(n => n.remove());
            const r = source.getBoundingClientRect();
            clone.style.setProperty('position', 'absolute', 'important'); clone.style.setProperty('margin', '0', 'important'); clone.style.setProperty('transform', 'none', 'important');
            clone.style.setProperty('left', `${r.left - area.left}px`, 'important'); clone.style.setProperty('top', `${r.top - area.top}px`, 'important');
            clone.inert = true; clone.setAttribute('aria-hidden', 'true'); cover.append(clone);
        });
        cover.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
        cover.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); cancelNavigation(); toast('원문 찾기를 중단했어요.'); });
        cover.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); cancelNavigation(); toast('원문 찾기를 중단했어요.'); }, { passive: false });
        document.body.append(cover);
        navigationView = { controller, end(restore) {
            if (restore && scroller.isConnected && roomPath() === fromRoom) {
                if (start?.body.isConnected && textKey(bodyText(start.body)) === textKey(start.text)) setScroll(scroller, scroller.scrollTop + start.body.getBoundingClientRect().top - startTop);
                else setScroll(scroller, initialScroll);
            }
            cover.remove();
        } };
        position();
    }
    async function jumpTo(record) {
        cancelNavigation(); setOpen(false);
        const controller = new AbortController(), signal = controller.signal, fromRoom = currentRoom;
        navigation = controller;
        const active = () => !signal.aborted && fromRoom === roomPath() && fromRoom === currentRoom;
        const started = Date.now(); let scroller = null, scrollers = [], direction = -1, unchangedSince = 0, boundary = '', steps = 0, scan = false, reversed = false, directed = false, reached = false, extent = -1, lower = null, upper = null, emptySince = 0;
        toast('북마크한 대화를 찾고 있어요…', '중단', cancelNavigation, true);
        try {
            while (active() && steps < MAX_SEARCH_STEPS && Date.now() - started < MAX_SEARCH_MS) {
                const searchBodies = collectBodies(true);
                let all = descriptions(searchBodies), found = resolve(record, all);
                if (!found.match && !found.ambiguous) {
                    const loose = looseSearchBodies(record, searchBodies);
                    if (loose.length) { all = descriptions([...searchBodies, ...loose]); found = resolve(record, all); }
                }
                if (found.ambiguous) { toast('같은 내용의 버블이 여러 개라 원문을 확정하지 못했어요.'); return; }
                if (found.match) {
                    const target = found.match.body;
                    const containers = conversationScrollers(target), fallback = scrollParent(target);
                    if (!containers.length && !fallback) { toast('대화의 스크롤 영역을 찾지 못했어요.'); return; }
                    for (const container of containers.length ? containers : [fallback]) {
                        const rect = target.getBoundingClientRect();
                        const viewportRect = container === document.scrollingElement ? { top: 0, height: innerHeight } : container.getBoundingClientRect();
                        const delta = rect.top - viewportRect.top - Math.max(24, (viewportRect.height - Math.min(rect.height, viewportRect.height - 48)) / 2);
                        setScroll(container, container.scrollTop + delta);
                    }
                    reached = true; lastLocation = { room: currentRoom, id: record.id, turn: found.match.turn || record.turn, until: Date.now() + 2400 };
                    closeNavigationView(controller, false);
                    // 긴 버블도 첫 부분이 보이도록 이동하고 2.4초 동안 표시.
                    markTarget(target, lastLocation.until);
                    position(); const focus = ribbons.get(target)?.button; if (focus && !focus.hidden) focus.focus({ preventScroll: true });
                    if (record.textVersion !== 2 && record.text !== found.match.text) {
                        const repaired = changeRecords(items => items.map(item => item.id === record.id && item.text === record.text
                            ? { ...item, text: found.match.text, textVersion: 2 } : item));
                        if (!repaired) return; // 이동은 완료. 저장 오류 안내를 성공 안내로 덮지 않음.
                    }
                    toast('북마크한 대화로 이동했어요.'); return;
                }
                if (!searchBodies.length) {
                    emptySince ||= Date.now();
                    if (Date.now() - emptySince > 15000) { toast('대화 본문이 아직 표시되지 않았어요. 로딩이 끝난 뒤 다시 눌러 주세요.'); return; }
                    noticeText.textContent = '과거 대화가 표시되기를 기다리는 중…'; steps++;
                    await waitForChange(signal, scroller?.isConnected ? scroller : document.querySelector('main') || document.body);
                    continue;
                }
                emptySince = 0;
                const nextScrollers = conversationScrollers(searchBodies);
                const nextScroller = nextScrollers[0] || scrollParent(searchBodies.find(body => body.closest(GROUP)) || searchBodies[0]);
                if (!nextScroller) { toast('대화의 스크롤 영역을 찾지 못했어요.'); return; }
                if (scroller !== nextScroller) {
                    scroller = nextScroller; scrollers = nextScrollers.length ? nextScrollers : [nextScroller];
                    unchangedSince = 0; boundary = ''; extent = -1; lower = upper = null; scan = false; reversed = false;
                    const firstHint = turnDirection(record, all, scroller); directed = !!firstHint; direction = firstHint?.direction || -1;
                    if (!navigationView) freezeNavigation(scroller, all, controller);
                } else scrollers = nextScrollers.length ? nextScrollers : [nextScroller];
                const range = scrollRange(scroller), before = scroller.scrollTop;
                if (extent !== range.max - range.min) { lower = upper = null; extent = range.max - range.min; }
                const hint = turnDirection(record, all, scroller);
                if (hint) {
                    directed = true;
                    reversed = false;
                    if (hint.direction > 0) lower = before; else upper = before;
                    if (hint.direction !== direction) { scan = true; direction = hint.direction; unchangedSince = 0; boundary = ''; }
                }
                const destination = lower !== null && upper !== null && upper - lower > 8 ? (lower + upper) / 2
                    : scan ? Math.max(range.min, Math.min(range.max, before + direction * Math.max(120, scroller.clientHeight * .8)))
                    : direction < 0 ? range.min : range.max;
                const pulseAt = Date.now();
                const driven = scan ? [scroller] : scrollers;
                driven.forEach(candidate => {
                    if (!candidate?.isConnected) return;
                    const candidateRange = scrollRange(candidate);
                    const candidateDestination = candidate === scroller ? destination : direction < 0 ? candidateRange.min : candidateRange.max;
                    setScroll(candidate, candidateDestination);
                    // 브라우저가 programmatic scroll 이벤트를 생략·지연해도 사이트의 지연 로더를 매번 깨운다.
                    candidate.dispatchEvent(new Event('scroll', { bubbles: false }));
                });
                steps++;
                noticeText.textContent = record.turn ? `${record.turn}턴 책갈피를 찾는 중…` : '북마크한 대화를 찾는 중…';
                await waitForChange(signal, document.querySelector('main') || scroller);
                // 다른 확장프로그램의 잦은 DOM 갱신으로 100회 한도가 몇 초 만에 소진되지 않게 탐색 주기를 보장.
                if (Date.now() - pulseAt < 600) await waitForChange(signal, null, 600 - (Date.now() - pulseAt));
                if (!active()) return;
                const currentBodies = collectBodies(true);
                const edge = direction < 0 ? currentBodies[0] : currentBodies[currentBodies.length - 1];
                const currentScrollers = conversationScrollers(currentBodies), edgeScrollers = scan ? [scroller] : currentScrollers.length ? currentScrollers : scrollers;
                const signature = `${edgeScrollers.map(node => `${node.scrollHeight}:${Math.round(node.scrollTop)}`).join(',')}|${currentBodies.length}|${edge?.closest(GROUP)?.getAttribute('data-message-group-id') || ''}|${edge ? normal(bodyText(edge)).slice(0, 120) : ''}`;
                const atEdge = edgeScrollers.every(node => {
                    const latestRange = scrollRange(node);
                    return direction < 0 ? node.scrollTop <= latestRange.min + 2 : node.scrollTop >= latestRange.max - 2;
                });
                if (!atEdge || signature !== boundary) unchangedSince = Date.now();
                else if (!unchangedSince) unchangedSince = Date.now();
                boundary = signature;
                const loading = [...scroller.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(node => !node.closest(OWN) && visible(node));
                const staleLimit = loading || directed ? 30000 : 6000;
                if (atEdge && Date.now() - unchangedSince >= staleLimit) {
                    // 가상 목록에서 북마크가 현재 위치보다 아래에 있을 수도 있어 반대 방향도 탐색.
                    if (!directed && !reversed) { direction *= -1; scan = true; reversed = true; lower = upper = null; unchangedSince = 0; boundary = ''; }
                    else break;
                }
            }
            if (active()) toast('원문을 찾지 못했어요. 더 오래된 대화를 직접 불러온 뒤 다시 눌러 주세요. 삭제되거나 다른 답변으로 바뀐 로그일 수도 있어요.', '목록 열기', () => setOpen(true), true);
        } catch {
            if (active()) toast('원문을 찾는 중 문제가 생겼어요. 대화를 불러온 뒤 다시 시도해 주세요.');
        } finally {
            closeNavigationView(controller, !reached);
            if (navigation === controller) navigation = null;
            scheduleScan(); schedulePosition();
        }
    }

    function reconcile() {
        scanTimer = 0;
        const nextRoom = roomPath();
        if (nextRoom !== currentRoom) {
            cancelNavigation(); currentRoom = nextRoom; setOpen(false); notice.hidden = true;
            undo = null; search.value = ''; bodies = [];
            ribbons.forEach(info => { info.button.remove(); if (info.surface) resizeObserver.unobserve(info.surface); }); ribbons.clear();
            loadRecords(); dirty = true;
        }
        if (!currentRoom) { overlay.hidden = true; toolbar.hidden = true; panel.hidden = true; return; }
        if (navigationView) return;
        if (dirty) {
            dirty = false; bodies = collectBodies();
            const shown = bodies.filter(body => appearance.showUser || roleFor(body) !== 'user');
            const live = new Set(shown);
            ribbons.forEach((info, body) => { if (!live.has(body)) { info.button.remove(); if (info.surface) resizeObserver.unobserve(info.surface); ribbons.delete(body); } });
            shown.forEach(body => {
                if (ribbons.has(body)) return;
                const ribbon = button('이 버블 북마크', RIBBON, () => toggleBookmark(body)); ribbon.className = 'cbb-ribbon cbb-bubble-ribbon';
                const info = { button: ribbon, kind: bubbleKind(bubbleSurface(body)), surface: null };
                attachFixedTap(ribbon); ribbons.set(body, info); overlay.append(ribbon);
            });
            refreshButtons();
        }
        mountToolbar(); syncTheme();
    }
    function scheduleScan() { dirty = true; if (!scanTimer) scanTimer = setTimeout(reconcile, 180); }
    const resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(panel);
    const observer = new MutationObserver(mutations => {
        const relevant = mutations.some(mutation => {
            const node = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
            if (node?.closest(OWN)) return false;
            if (mutation.type === 'childList' && !mutation.removedNodes.length && mutation.addedNodes.length
                && [...mutation.addedNodes, ...mutation.removedNodes].every(n => n.nodeType === Node.ELEMENT_NODE && n.matches(OWN))) return false;
            return true;
        });
        if (relevant) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-message-group-id', 'data-message-id', 'data-message-role', 'data-role', 'data-turn', 'data-turn-number', 'data-theme', 'data-sgb-bubble', 'data-cmu-theme-bubble', 'data-sgb-input-box', 'data-cmu-theme-input-box', 'data-cmu-theme-input-host', 'class', 'style', 'hidden'] });
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-sgb-theme', 'data-cmu-theme'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
    window.addEventListener('scroll', schedulePosition, { passive: true, capture: true });
    function resized() { if (navigationView) { cancelNavigation(); toast('화면 크기가 바뀌어 원문 찾기를 중단했어요. 다시 눌러 주세요.'); } schedulePosition(); }
    window.addEventListener('resize', resized, { passive: true });
    window.visualViewport?.addEventListener('resize', resized, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedulePosition, { passive: true });
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('storage', event => {
        if (event.key === APPEARANCE_KEY) { appearance = readAppearance(); applyAppearance(); return; }
        if (event.key === key() || event.key === null) {
            loadRecords(); if (!editingId) renderList(); refreshButtons();
        }
    });
    // SPA 이동, 입력창 교체, 가상 목록 재사용에도 계속 동작. history/fetch를 덮어쓰지 않음.
    setInterval(() => {
        if (roomPath() !== currentRoom || (currentRoom && (!toolbar.isConnected || !bodies.length))) scheduleScan();
    }, 700);
    // CSS 레이아웃/테마 전환으로 크기 변화 없이 이동하는 경우에도 위치를 따라감.
    setInterval(() => { if (currentRoom && document.visibilityState === 'visible') schedulePosition(); }, 250);
    loadRecords(); reconcile();
})();
