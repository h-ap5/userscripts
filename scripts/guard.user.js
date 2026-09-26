// ==UserScript==
// @name         🛑 Crack 일일 크래커 가드
// @namespace    crack-daily-cracker-guard
// @version      1.2.8
// @description  오늘 사용한 크래커를 내역 API로 합산하고, 설정한 일일 목표의 허용 구간 안에서 메시지 전송과 재생성을 막습니다.
// @match        https://crack.wrtn.ai/*
// @match        http://crack.wrtn.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=crack.wrtn.ai
// @run-at       document-start
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'Crack 일일 크래커 가드';
    const VERSION = '1.4.0';
    const API_HISTORY = 'https://crack-api.wrtn.ai/crack-cash/crackers/history';
    const CONFIG_KEY = 'cdc_guard_config_v1';
    // 첨부된 대시보드가 실제로 사용 중인 API 페이지 크기에 맞춘다.
    const PAGE_SIZE = 20;
    const MAX_HISTORY_PAGES = 50;
    const REFRESH_INTERVAL_MS = 20_000;
    const RESUME_DEBOUNCE_MS = 180;
    const UI_WATCHDOG_INTERVAL_MS = 3_000;
    const MAX_STALE_MS = 2 * 60_000;
    const REQUEST_TIMEOUT_MS = 12_000;
    const BLOCKED_TITLE = '일일 크래커 가드가 전송을 차단했습니다';

    const DEFAULT_CONFIG = Object.freeze({
        enabled: true,
        dailyLimit: 1000,
        safetyMargin: 200,
        blockRegeneration: true,
    });

    const nativeFetch = window.fetch.bind(window);
    let config = loadConfig();
    let refreshTimer = null;
    let resumeTimer = null;
    let refreshQueued = false;
    let refreshQueuedAnnounce = false;
    let refreshQueuedActiveOnly = true;
    let composerObserver = null;
    let themeObserver = null;
    let uiResizeObserver = null;
    let composerUpdateTimer = null;
    let uiPositionTimer = null;
    let uiGeometryFrame = null;
    let postSendTimers = [];
    let toastTimer = null;
    let currentUiInlineHost = null;
    let currentUiMountParent = null;
    let currentUiRadiosonde = null;
    let currentReservedHost = null;
    let observedPathname = window.location.pathname;
    const GUARD_PILL_HEIGHT = 20;
    const GUARD_STACK_GAP = 4;

    const seoulDayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });

    const state = {
        used: 0,
        recordCount: 0,
        lastUpdatedAt: 0,
        loading: false,
        error: '',
        pagesRead: 0,
        lastConsumption: 0,
        panelOpen: false,
    };

    const ui = {
        host: null,
        shadow: null,
        pill: null,
        pillText: null,
        panel: null,
        statusText: null,
        gauge: null,
        summary: null,
        message: null,
        updatedValue: null,
        enabledInput: null,
        limitInput: null,
        marginInput: null,
        regenerationInput: null,
        validation: null,
        refreshButton: null,
        toast: null,
    };

    function clampInteger(value, min, max, fallback) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function loadConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
            if (!saved || typeof saved !== 'object') return { ...DEFAULT_CONFIG };
            const dailyLimit = clampInteger(saved.dailyLimit, 1, 10_000_000, DEFAULT_CONFIG.dailyLimit);
            const safetyMargin = clampInteger(saved.safetyMargin, 0, dailyLimit - 1, DEFAULT_CONFIG.safetyMargin);
            return {
                enabled: saved.enabled !== false,
                dailyLimit,
                safetyMargin,
                blockRegeneration: saved.blockRegeneration !== false,
            };
        } catch (error) {
            return { ...DEFAULT_CONFIG };
        }
    }

    function saveConfig(nextConfig) {
        config = { ...nextConfig };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        render();
        syncComposerButton();
    }

    function getTargetRange(source = config) {
        const target = Math.max(1, Number(source.dailyLimit) || DEFAULT_CONFIG.dailyLimit);
        const tolerance = Math.max(0, Number(source.safetyMargin) || 0);
        return {
            target,
            tolerance,
            lower: Math.max(0, target - tolerance),
            upper: target + tolerance,
        };
    }

    function getBudgetDecision() {
        const range = getTargetRange();
        const used = Math.max(0, Number(state.used) || 0);
        const estimate = Math.max(0, Number(state.lastConsumption) || 0);

        if (used < range.lower) {
            return { blocked: false, phase: 'below-range', range, estimate };
        }
        if (used >= range.upper) {
            return { blocked: true, phase: 'upper-reached', range, estimate };
        }
        if (used >= range.target) {
            return { blocked: true, phase: 'target-reached', range, estimate };
        }

        // 허용 구간의 하반부에서는 최근 1회 소모량을 다음 소비의 근삿값으로 쓴다.
        // 한 번 더 보냈을 때 목표에 더 가까워지고 상한을 넘지 않는 경우만 통과시킨다.
        if (estimate > 0) {
            const predicted = used + estimate;
            const currentDistance = range.target - used;
            const predictedDistance = Math.abs(range.target - predicted);
            if (predicted <= range.upper && predictedDistance < currentDistance) {
                return {
                    blocked: false,
                    phase: 'approaching-target',
                    range,
                    estimate,
                    predicted,
                };
            }
        }

        return { blocked: true, phase: 'range-stop', range, estimate };
    }

    function getBlockReason() {
        if (!config.enabled) return '';

        if (!state.lastUpdatedAt) {
            return state.loading
                ? '오늘 사용량을 확인하는 동안 잠시 전송을 막고 있어요.'
                : '사용 내역을 확인하지 못해 안전을 위해 전송을 막고 있어요.';
        }

        if (state.error && Date.now() - state.lastUpdatedAt > MAX_STALE_MS) {
            return '사용 내역이 오래되어 안전을 위해 전송을 막고 있어요.';
        }

        const decision = getBudgetDecision();
        if (!decision.blocked) return '';
        const { range } = decision;
        if (decision.phase === 'upper-reached') {
            return `오늘 ${formatNumber(state.used)}개로 멈춤 구간 상한 ${formatNumber(range.upper)}개를 넘었어요.`;
        }
        if (decision.phase === 'target-reached') {
            return `오늘 ${formatNumber(state.used)}개로 목표 ${formatNumber(range.target)}개에 닿았어요.`;
        }
        return `오늘 ${formatNumber(state.used)}개로 멈춤 구간 ${formatNumber(range.lower)}~${formatNumber(range.upper)}개에 들어왔어요.`;
    }

    function isBlocked() {
        return Boolean(getBlockReason());
    }

    function formatNumber(value) {
        return Math.max(0, Number(value) || 0).toLocaleString('ko-KR');
    }

    function formatTime(timestamp) {
        if (!timestamp) return '아직 확인 전';
        return timeFormatter.format(new Date(timestamp));
    }

    function extractAccessToken() {
        for (const chunk of document.cookie.split(';')) {
            const cookie = chunk.trim();
            if (!cookie.startsWith('access_token=')) continue;
            const value = cookie.slice('access_token='.length);
            try {
                return decodeURIComponent(value);
            } catch (error) {
                return value;
            }
        }
        return '';
    }

    async function apiGet(url) {
        const token = extractAccessToken();
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await nativeFetch(url, {
                method: 'GET',
                headers,
                cache: 'no-store',
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function getHistoryItems(payload) {
        if (Array.isArray(payload?.data)) return payload.data;
        if (Array.isArray(payload?.data?.items)) return payload.data.items;
        if (Array.isArray(payload?.data?.histories)) return payload.data.histories;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.histories)) return payload.histories;
        return [];
    }

    function getTotalPages(payload) {
        const candidates = [
            payload?.meta?.totalPages,
            payload?.meta?.totalPage,
            payload?.pagination?.totalPages,
            payload?.pagination?.totalPage,
            payload?.data?.meta?.totalPages,
            payload?.data?.pagination?.totalPages,
        ];
        for (const candidate of candidates) {
            const value = Number(candidate);
            if (Number.isFinite(value) && value > 0) return Math.floor(value);
        }
        return null;
    }

    function getRecordTime(record) {
        const value = record?.date
            || record?.createdAt
            || record?.created_at
            || record?.updatedAt
            || '';
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function getRawAmount(record) {
        const candidates = [
            record?.balance?.total,
            record?.crackerQuantity,
            record?.quantity,
            record?.amount,
        ];
        for (let candidate of candidates) {
            if (typeof candidate === 'string') {
                candidate = Number(candidate.replace(/[^0-9.-]/g, ''));
            }
            if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate !== 0) {
                return candidate;
            }
        }
        return 0;
    }

    function getConsumedAmount(record) {
        const explicitlyConsumed = record?.isConsumed === true
            || String(record?.isConsumed).toLowerCase() === 'true';
        const explicitlyNotConsumed = record?.isConsumed === false
            || String(record?.isConsumed).toLowerCase() === 'false';
        if (explicitlyNotConsumed) return 0;

        const product = String(record?.product || '').toLowerCase();
        if (product && !product.includes('cracker')) return 0;

        const usageHint = [
            record?.consumedType,
            record?.type,
            record?.transactionType,
            record?.title,
        ].filter(Boolean).join(' ');
        const inferredConsumed = /consum|usage|used|차감|사용|소모/i.test(usageHint);

        const rawAmount = getRawAmount(record);
        if (!rawAmount) return 0;
        if (!explicitlyConsumed && !inferredConsumed && rawAmount > 0) return 0;
        return Math.abs(rawAmount);
    }

    function makeRecordKey(record) {
        const id = record?._id
            || record?.id
            || record?.historyId
            || record?.transactionId
            || '';
        if (id) return `id:${id}`;
        return [
            'history',
            record?.date || record?.createdAt || '',
            record?.title || '',
            getConsumedAmount(record),
            record?.balance?.paid ?? '',
            record?.balance?.free ?? '',
            record?.consumedType || '',
        ].join('|');
    }

    function getSeoulDayRange(now = Date.now()) {
        const parts = seoulDayFormatter.formatToParts(new Date(now));
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const start = Date.UTC(
            Number(values.year),
            Number(values.month) - 1,
            Number(values.day),
        ) - (9 * 60 * 60 * 1000);
        return { start, end: start + (24 * 60 * 60 * 1000) };
    }

    async function fetchTodayUsage() {
        const { start, end } = getSeoulDayRange();
        const seen = new Set();
        let sum = 0;
        let recordCount = 0;
        let pagesRead = 0;
        let latestRecordTime = 0;
        let lastConsumption = 0;

        for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
            const query = new URLSearchParams({
                limit: String(PAGE_SIZE),
                type: 'all',
                page: String(page),
            });
            const payload = await apiGet(`${API_HISTORY}?${query.toString()}`);
            const items = getHistoryItems(payload);
            const totalPages = getTotalPages(payload);
            let reachedOlderRecord = false;
            pagesRead = page;

            for (const record of items) {
                const timestamp = getRecordTime(record);
                if (!timestamp) continue;
                if (timestamp < start) {
                    reachedOlderRecord = true;
                    continue;
                }
                if (timestamp >= end) continue;

                const amount = getConsumedAmount(record);
                if (amount <= 0) continue;
                const key = makeRecordKey(record);
                if (seen.has(key)) continue;
                seen.add(key);
                sum += amount;
                recordCount += 1;
                if (timestamp > latestRecordTime) {
                    latestRecordTime = timestamp;
                    lastConsumption = amount;
                }
            }

            if (!items.length) break;
            if (totalPages && page >= totalPages) break;
            if (items.length < PAGE_SIZE) break;
            if (reachedOlderRecord) break;
        }

        return { used: sum, recordCount, pagesRead, lastConsumption };
    }

    async function refreshUsage(options = {}) {
        const force = options.force === true;
        const activeOnly = options.activeOnly !== false;

        if (activeOnly && (!isChatPage() || document.visibilityState !== 'visible')) return false;

        const age = Date.now() - state.lastUpdatedAt;
        if (!force && state.lastUpdatedAt && age < REFRESH_INTERVAL_MS) {
            scheduleNextRefresh(REFRESH_INTERVAL_MS - age);
            return false;
        }

        if (state.loading) {
            // 수동 갱신과 전송 후 검사는 로딩 중이어도 버리지 않고 한 번만 뒤따라 실행한다.
            if (force) {
                refreshQueued = true;
                refreshQueuedAnnounce ||= options.announce === true;
                refreshQueuedActiveOnly &&= activeOnly;
            }
            return false;
        }

        stopRefreshTimer();
        state.loading = true;
        state.error = '';
        render();
        syncComposerButton();

        try {
            const result = await fetchTodayUsage();
            state.used = result.used;
            state.recordCount = result.recordCount;
            state.pagesRead = result.pagesRead;
            state.lastConsumption = result.lastConsumption;
            state.lastUpdatedAt = Date.now();
            state.error = '';
            if (options.announce) showToast('오늘 사용량을 새로 확인했어요.', 'ok');
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? '사용 내역 확인 시간이 초과됐어요.'
                : `사용 내역을 불러오지 못했어요${error?.message ? ` (${error.message})` : '.'}`;
            state.error = message;
            console.warn(`[${SCRIPT_NAME}]`, message, error);
            if (options.announce) showToast(message, 'error');
        } finally {
            state.loading = false;
            render();
            syncComposerButton();

            const runQueued = refreshQueued;
            const announceQueued = refreshQueuedAnnounce;
            const queuedActiveOnly = refreshQueuedActiveOnly;
            refreshQueued = false;
            refreshQueuedAnnounce = false;
            refreshQueuedActiveOnly = true;

            if (runQueued && (
                !queuedActiveOnly
                || (isChatPage() && document.visibilityState === 'visible')
            )) {
                window.queueMicrotask(() => refreshUsage({
                    force: true,
                    announce: announceQueued,
                    activeOnly: queuedActiveOnly,
                }));
            } else {
                scheduleNextRefresh();
            }
        }
        return true;
    }

    function clearPostSendTimers() {
        for (const timer of postSendTimers) window.clearTimeout(timer);
        postSendTimers = [];
    }

    function schedulePostSendRefreshes() {
        clearPostSendTimers();
        for (const delay of [4_000, 10_000, 22_000]) {
            postSendTimers.push(window.setTimeout(
                () => refreshUsage({ force: true }),
                delay,
            ));
        }
    }

    const CHAT_PAGE_PATTERNS = [
        /^\/stories\/[^/]+\/episodes(?:\/|$)/i,
        /^\/characters\/[^/]+\/chats(?:\/|$)/i,
        /^\/stories\/[^/]+\/parties\/(?!new(?:\/|$))[^/]+\/?$/i,
        /^\/u\/[^/]+\/c\/[^/]+\/?$/i,
        /^\/arpg\/[^/]+\/(?:play\/[^/]+|[^/]+\/play)\/?$/i,
        /^\/fliptale\/play\/?$/i,
    ];

    function isChatPage() {
        return CHAT_PAGE_PATTERNS.some(
            (pattern) => pattern.test(window.location.pathname),
        );
    }

    const CHAT_EDITOR_SELECTORS = [
        '[data-sgb-input-box] .__chat_input_textarea',
        '[data-sgb-input-box] textarea',
        '[data-sgb-input-box] [contenteditable="true"]',
        'textarea.__chat_input_textarea',
        '[contenteditable="true"].__chat_input_textarea',
        'textarea[placeholder*="메시지"]',
        'textarea[placeholder*="채팅"]',
        'textarea[aria-label*="메시지"]',
        '[contenteditable="true"][data-placeholder*="메시지"]',
        '[contenteditable="true"][aria-label*="메시지"]',
    ];
    const COMPOSER_WATCH_SELECTOR = [
        ...CHAT_EDITOR_SELECTORS,
        '[data-sgb-input-host]',
        '[data-sgb-input-box]',
        '.igx-inline-overlay-host',
        '#igx-live-popup',
    ].join(', ');

    function elementTouchesComposer(element) {
        if (!(element instanceof Element)) return false;
        if (element.matches('#cdcg-root') || element.closest('#cdcg-root')) return false;
        if (element.matches(COMPOSER_WATCH_SELECTOR) || element.querySelector(COMPOSER_WATCH_SELECTOR)) {
            return true;
        }
        if (
            currentUiInlineHost instanceof HTMLElement
            && (element === currentUiInlineHost || element.contains(currentUiInlineHost))
        ) return true;
        if (
            currentUiMountParent instanceof HTMLElement
            && (element === currentUiMountParent || element.contains(currentUiMountParent))
        ) return true;
        return Boolean(
            currentUiInlineHost instanceof HTMLElement
            && currentUiInlineHost.contains(element)
            && element.closest('button, form, textarea, [contenteditable="true"]'),
        );
    }

    function mutationTouchesComposer(mutation) {
        const target = mutation.target instanceof Element
            ? mutation.target
            : mutation.target?.parentElement;
        if (target?.closest('#cdcg-root')) return false;
        return [...mutation.addedNodes, ...mutation.removedNodes]
            .some((node) => elementTouchesComposer(node));
    }

    function isVisibleElement(element) {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0';
    }

    function getVisibleChatEditors(scope = document) {
        if (!isChatPage()) return [];

        const root = scope instanceof Element || scope instanceof Document ? scope : document;
        const found = [];
        const seen = new Set();

        for (const selector of CHAT_EDITOR_SELECTORS) {
            for (const element of root.querySelectorAll(selector)) {
                if (!(element instanceof HTMLElement) || seen.has(element)) continue;
                if (element.closest(
                    '#cdcg-root, [role="dialog"], [aria-modal="true"], [data-sidebar="sidebar"], .bg-sidebar',
                )) continue;
                seen.add(element);
                if (isVisibleElement(element)) found.push(element);
            }
        }

        return found.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            if (Math.abs(ar.bottom - br.bottom) > 2) return ar.bottom - br.bottom;
            return ar.width - br.width;
        });
    }

    function getVisibleChatEditor(scope = document) {
        const editors = getVisibleChatEditors(scope);
        return editors[editors.length - 1] || null;
    }

    function getComposerFromEditor(editor) {
        if (!(editor instanceof HTMLElement)) return null;

        const sgbComposer = editor.closest('[data-sgb-input-box]');
        if (sgbComposer instanceof HTMLElement) return sgbComposer;

        const form = editor.closest('form');
        if (form instanceof HTMLElement) return form;

        const editorRect = editor.getBoundingClientRect();
        let current = editor.parentElement;
        let depth = 0;
        while (current && current !== document.body && depth < 6) {
            const rect = current.getBoundingClientRect();
            const hasButton = Boolean(current.querySelector('button'));
            const widthReasonable = rect.width >= editorRect.width
                && rect.width <= Math.max(editorRect.width + 320, editorRect.width * 1.8);
            const heightReasonable = rect.height >= editorRect.height && rect.height < 320;
            if (hasButton && widthReasonable && heightReasonable) return current;
            current = current.parentElement;
            depth += 1;
        }

        return editor.parentElement instanceof HTMLElement ? editor.parentElement : editor;
    }

    function isChatEditor(target) {
        if (!(target instanceof Element)) return false;
        const activeEditor = getVisibleChatEditor();
        return Boolean(activeEditor && (target === activeEditor || activeEditor.contains(target)));
    }

    function getVisibleComposer() {
        if (!isChatPage()) return null;
        return getComposerFromEditor(getVisibleChatEditor());
    }

    function findSendButton(composer = getVisibleComposer()) {
        if (!(composer instanceof HTMLElement)) return null;

        const explicitSelectors = [
            'button[data-cdcg-send-button="1"]',
            'button[data-crack-ui-empty-send-guard]',
            'button[type="submit"]',
            'button[aria-label*="메시지 보내"]',
            'button[aria-label*="보내기"]',
            'button[aria-label*="전송"]',
            'button[title*="메시지 보내"]',
            'button[title*="보내기"]',
            'button[title*="전송"]',
        ];
        for (const selector of explicitSelectors) {
            const matches = Array.from(composer.querySelectorAll(selector)).filter(isVisibleElement);
            if (matches.length) return matches[matches.length - 1];
        }

        const buttons = Array.from(composer.querySelectorAll('button')).filter(isVisibleElement);
        const styledCandidates = buttons.filter((button) => {
            const className = String(button.className || '');
            return button.querySelector('svg')
                && className.includes('bg-primary')
                && className.includes('text-primary-foreground');
        });
        if (styledCandidates.length) return styledCandidates[styledCandidates.length - 1];

        // 순정 UI 클래스명이 바뀐 경우: 입력창 오른쪽에 있는 SVG 버튼을 전송 버튼 후보로 사용.
        const editor = getVisibleChatEditor(composer) || getVisibleChatEditor();
        if (editor) {
            const editorRect = editor.getBoundingClientRect();
            const svgButtons = buttons.filter((button) => {
                if (!button.querySelector('svg')) return false;
                const rect = button.getBoundingClientRect();
                return rect.left >= editorRect.left + (editorRect.width * 0.55)
                    && rect.bottom >= editorRect.top - 12
                    && rect.top <= editorRect.bottom + 12;
            });
            if (svgButtons.length) return svgButtons[svgButtons.length - 1];
        }

        return null;
    }

    function isSendButtonTarget(target) {
        if (!(target instanceof Element)) return false;
        const button = target.closest('button');
        if (!button) return false;
        return button === findSendButton();
    }

    function isRegenerationTarget(target) {
        if (
            !isChatPage()
            || !config.blockRegeneration
            || !(target instanceof Element)
        ) return false;
        const button = target.closest('button, [role="button"]');
        if (!button || button.closest(
            '#cdcg-root, [role="dialog"], [aria-modal="true"], [data-sidebar="sidebar"], .bg-sidebar',
        )) return false;
        const label = [
            button.getAttribute('aria-label'),
            button.getAttribute('title'),
            button.textContent,
        ].filter(Boolean).join(' ').trim();
        if (!/다시\s*생성|재생성|리롤|reroll|regenerate/i.test(label)) return false;
        return Boolean(getVisibleChatEditor());
    }

    function blockEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showBlockedToast();
    }

    function showBlockedToast() {
        const reason = getBlockReason() || '일일 크래커 가드가 전송을 막았어요.';
        showToast(reason, 'blocked');
    }

    function handlePointerOrClick(event) {
        const sendAttempt = isSendButtonTarget(event.target);
        const regenerationAttempt = !sendAttempt && isRegenerationTarget(event.target);
        if (!sendAttempt && !regenerationAttempt) return;

        if (isBlocked()) {
            blockEvent(event);
            return;
        }
        if (event.type === 'click') schedulePostSendRefreshes();
    }

    function handleKeydown(event) {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        if (!isChatEditor(event.target)) return;

        if (isBlocked()) {
            blockEvent(event);
            return;
        }
        schedulePostSendRefreshes();
    }

    function handleSubmit(event) {
        if (!isChatPage()) return;

        const form = event.target instanceof Element ? event.target.closest('form') : null;
        if (!(form instanceof HTMLElement)) return;

        const activeEditor = getVisibleChatEditor();
        if (!activeEditor || !form.contains(activeEditor)) return;

        if (isBlocked()) blockEvent(event);
        else schedulePostSendRefreshes();
    }

    function restoreButtonAccessibility(button) {
        if (!button.hasAttribute('data-cdcg-original-title')) return;

        const originalTitle = button.getAttribute('data-cdcg-original-title');
        if (originalTitle === '__absent__') button.removeAttribute('title');
        else button.setAttribute('title', originalTitle);

        const originalAriaDisabled = button.getAttribute('data-cdcg-original-aria-disabled');
        if (originalAriaDisabled === '__absent__') button.removeAttribute('aria-disabled');
        else button.setAttribute('aria-disabled', originalAriaDisabled);

        button.removeAttribute('data-cdcg-original-title');
        button.removeAttribute('data-cdcg-original-aria-disabled');
    }

    function markButtonBlocked(button) {
        if (!button.hasAttribute('data-cdcg-original-title')) {
            button.setAttribute(
                'data-cdcg-original-title',
                button.hasAttribute('title') ? button.getAttribute('title') : '__absent__',
            );
            button.setAttribute(
                'data-cdcg-original-aria-disabled',
                button.hasAttribute('aria-disabled') ? button.getAttribute('aria-disabled') : '__absent__',
            );
        }
        button.setAttribute('data-cdcg-send-button', '1');
        button.setAttribute('data-cdcg-send-blocked', '1');
        button.setAttribute('title', BLOCKED_TITLE);
        button.setAttribute('aria-disabled', 'true');
    }

    function unmarkButtonBlocked(button) {
        button.removeAttribute('data-cdcg-send-blocked');
        restoreButtonAccessibility(button);
    }

    function syncComposerButton() {
        const currentButton = findSendButton();
        const markedButtons = Array.from(document.querySelectorAll('button[data-cdcg-send-button="1"]'));

        for (const button of markedButtons) {
            if (button !== currentButton) {
                unmarkButtonBlocked(button);
                button.removeAttribute('data-cdcg-send-button');
            }
        }

        if (!currentButton) return;
        currentButton.setAttribute('data-cdcg-send-button', '1');
        if (isBlocked()) markButtonBlocked(currentButton);
        else unmarkButtonBlocked(currentButton);
    }

    function injectOuterStyle() {
        if (document.getElementById('cdcg-outer-style')) return;
        const style = document.createElement('style');
        style.id = 'cdcg-outer-style';
        style.textContent = `
            /* 단독 라디오존데처럼 입력창 호스트 위에 겹쳐 그리는 막대가 있을 때만
               가드 한 줄만큼 호스트를 늘리고 그 막대를 같이 내려 가드 자리를 만든다. */
            [data-cdcg-guard-space="1"] {
                padding-top: calc(var(--cdcg-base-padding-top, 0px) + var(--cdcg-guard-reserve, 24px)) !important;
            }

            [data-cdcg-guard-space="1"] > #igx-live-popup {
                top: calc(var(--cdcg-radio-base-top, 6px) + var(--cdcg-guard-reserve, 24px)) !important;
            }

            #cdcg-root {
                position: absolute !important;
                top: var(--cdcg-inline-top, 0px) !important;
                left: var(--cdcg-inline-left, 0px) !important;
                width: var(--cdcg-inline-width, 100%) !important;
                height: 20px !important;
                overflow: visible !important;
                z-index: 2 !important;
                pointer-events: none !important;
            }

            #cdcg-root[hidden] {
                display: none !important;
            }

            button[data-cdcg-send-blocked="1"] {
                cursor: not-allowed !important;
                filter: grayscale(.7) !important;
                opacity: .46 !important;
                transform: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    const ICON_PATHS = Object.freeze({
        close: '<path d="M6 6l12 12M18 6L6 18"/>',
        minus: '<path d="M5 12h14"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
        target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
        range: '<path d="M7 8l-4 4 4 4M17 8l4 4-4 4M3 12h18"/>',
        repeat: '<path d="M4 12V9a3 3 0 0 1 3-3h13"/><path d="M17 3l3 3-3 3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/><path d="M7 21l-3-3 3-3"/>',
        refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2"/><path d="M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2"/><path d="M20 19v-4h-4"/>',
    });

    function icon(name, className = '') {
        return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
    }

    function mountUi() {
        if (ui.host || !document.body) return;
        injectOuterStyle();

        const host = document.createElement('div');
        host.id = 'cdcg-root';
        host.dataset.theme = getPageTheme();
        host.dataset.skin = 'crack';
        host.hidden = true;
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                /* 크랙이 body에 둔 색 토큰을 그대로 쓴다. 두 번째 값은 토큰이 없을 때의 다크 기본값. */
                :host {
                    --g-surface: var(--bg_elevated_primary, #242321);
                    --g-surface-image: none;
                    --g-backdrop: none;
                    --g-control: var(--surface_tertiary, #2E2D2B);
                    --g-line: var(--divider_secondary, #42413D);
                    --g-text: var(--text_primary, #F0EFEB);
                    --g-text-2: var(--text_secondary, #A8A69D);
                    --g-text-3: var(--text_tertiary, #85837D);
                    --g-hover: var(--state_hover, rgba(255, 255, 255, .1));
                    --g-switch-on: var(--surface_primary, #FCFCFA);
                    --g-switch-off: var(--divider_primary, #61605A);
                    --g-thumb: var(--bg_screen, #141413);
                    --g-safe: var(--alert_success, #2CAA00);
                    --g-near: var(--icon_cracker_primary, #FFB938);
                    --g-danger: var(--text_brand, #FF6352);
                    --g-warn: var(--alert_warning, #FFAA00);
                    --g-off: var(--text_tertiary, #85837D);
                    --g-band: var(--surface_brand_secondary, #6D231C);
                    --g-caret: var(--text_brand, #FF6352);
                    --g-focus: hsl(var(--focus, 240 5% 84% / .5));
                    --g-shadow: 0 12px 32px rgba(0, 0, 0, .38), 0 2px 8px rgba(0, 0, 0, .22);
                    --cdcg-inline-text: var(--sgb-readable-text, var(--text_primary, rgba(255, 255, 255, .88)));
                    --cdcg-inline-muted: var(--sgb-muted-text, var(--text_secondary, rgba(255, 255, 255, .58)));
                    all: initial;
                    color: var(--g-text);
                    font-family: Pretendard, "Pretendard Variable", "Apple SD Gothic Neo", system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif;
                }

                :host([data-theme="light"]) {
                    --g-surface: var(--bg_elevated_primary, #FFFFFF);
                    --g-control: var(--surface_tertiary, #F7F7F5);
                    --g-line: var(--divider_secondary, #DBDAD5);
                    --g-text: var(--text_primary, #1A1918);
                    --g-text-2: var(--text_secondary, #61605A);
                    --g-hover: var(--state_hover, rgba(0, 0, 0, .1));
                    --g-switch-on: var(--surface_primary, #0D0D0C);
                    --g-switch-off: var(--divider_primary, #C7C5BD);
                    --g-thumb: var(--bg_screen, #FFFFFF);
                    --g-near: var(--icon_cracker_primary, #D68B00);
                    --g-danger: var(--text_brand, #FF4432);
                    --g-band: var(--surface_brand_secondary, #FFCFC7);
                    --g-caret: var(--text_brand, #FF4432);
                    --g-focus: hsl(var(--focus, 0 0% 64% / .5));
                    --g-shadow: 0 12px 32px rgba(26, 25, 24, .14), 0 2px 8px rgba(26, 25, 24, .08);
                    --cdcg-inline-text: var(--sgb-readable-text, var(--text_primary, rgba(0, 0, 0, .82)));
                    --cdcg-inline-muted: var(--sgb-muted-text, var(--text_secondary, rgba(0, 0, 0, .58)));
                }

                /* 테마 확프가 입력창을 꾸민 경우: 바탕·선·글자만 입력창을 따르고 상태 색은 크랙 것을 유지한다. */
                :host([data-skin="composer"]) {
                    --g-surface: var(--cdcg-panel-bg, rgba(24, 24, 27, .86));
                    --g-surface-image: var(--cdcg-inline-bg-image, none);
                    --g-backdrop: var(--cdcg-panel-backdrop, blur(16px));
                    --g-line: var(--cdcg-inline-border, rgba(255, 255, 255, .16));
                    --g-text: var(--sgb-readable-text, var(--text_primary, #F0EFEB));
                    --g-text-2: var(--sgb-muted-text, var(--text_secondary, #A8A69D));
                    --g-text-3: var(--sgb-muted-text, var(--text_tertiary, #85837D));
                    --g-control: rgba(255, 255, 255, .08);
                    --g-hover: rgba(255, 255, 255, .1);
                    --g-switch-off: rgba(255, 255, 255, .26);
                }

                :host([data-skin="composer"][data-theme="light"]) {
                    --g-control: rgba(0, 0, 0, .05);
                    --g-hover: rgba(0, 0, 0, .06);
                    --g-switch-off: rgba(0, 0, 0, .18);
                }

                *, *::before, *::after { box-sizing: border-box; }
                button, input { margin: 0; font: inherit; color: inherit; letter-spacing: inherit; }
                button { -webkit-tap-highlight-color: transparent; }
                svg { display: block; flex: none; }

                .dock {
                    position: absolute;
                    inset: auto 0 0 0;
                    width: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    pointer-events: none;
                }

                .pill,
                .panel,
                .toast { pointer-events: auto; }

                .toast { order: 1; }
                .panel { order: 2; }
                .pill { order: 3; }

                .pill {
                    --g-state: var(--g-safe);
                    width: 100%;
                    height: 20px;
                    min-height: 20px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 0 6px;
                    border: 1px solid var(--cdcg-inline-border, var(--g-line));
                    border-radius: var(--cdcg-inline-radius, 6px);
                    background-color: var(--cdcg-inline-bg-color, var(--g-surface));
                    background-image: var(--cdcg-inline-bg-image, none);
                    backdrop-filter: var(--cdcg-inline-backdrop, none);
                    -webkit-backdrop-filter: var(--cdcg-inline-backdrop, none);
                    color: var(--cdcg-inline-text);
                    cursor: pointer;
                    transition: filter 140ms ease;
                }

                .pill:hover { filter: brightness(1.08); }
                .pill:active { opacity: .72; }
                .pill:focus-visible { outline: 2px solid var(--g-focus); outline-offset: 1px; }

                .pill-copy {
                    width: 100%;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .pill-status {
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    overflow: hidden;
                }

                .dot {
                    width: 6px;
                    height: 6px;
                    flex: 0 0 6px;
                    border-radius: 50%;
                    background: var(--g-state);
                }

                .pill-summary {
                    overflow: hidden;
                    color: var(--cdcg-inline-muted);
                    font-size: 10px;
                    font-weight: 500;
                    line-height: 1;
                    font-variant-numeric: tabular-nums;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .pill-label {
                    overflow: hidden;
                    color: var(--cdcg-inline-text);
                    font-size: 11px;
                    font-weight: 600;
                    line-height: 1;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .pill[data-status="blocked"] .pill-summary { color: var(--g-danger); }
                .pill[data-status="warning"] .pill-summary { color: var(--g-warn); }

                .pill[data-status="blocked"] .dot {
                    box-shadow: 0 0 6px var(--g-danger);
                    animation: cdcg-blocked-pulse 1.25s ease-in-out infinite;
                }

                @keyframes cdcg-blocked-pulse {
                    0%, 100% { opacity: .62; }
                    50% { opacity: 1; }
                }

                .panel {
                    --g-state: var(--g-safe);
                    width: min(292px, calc(100vw - 16px));
                    max-height: min(460px, 72vh, var(--cdcg-panel-max-height, 460px));
                    align-self: flex-end;
                    display: flex;
                    flex-direction: column;
                    overflow: auto;
                    overscroll-behavior: contain;
                    padding: 12px 0 6px;
                    border: 1px solid var(--g-line);
                    border-radius: 12px;
                    background-color: var(--g-surface);
                    background-image: var(--g-surface-image);
                    -webkit-backdrop-filter: var(--g-backdrop);
                    backdrop-filter: var(--g-backdrop);
                    box-shadow: var(--g-shadow);
                    color: var(--g-text);
                    font-size: 14px;
                    line-height: 1.45;
                    transform-origin: 100% 100%;
                    animation: cdcg-pop 180ms cubic-bezier(.16, 1, .3, 1);
                    scrollbar-width: thin;
                    scrollbar-color: var(--g-line) transparent;
                }

                .panel[hidden] { display: none; }
                .panel:focus { outline: none; }
                .panel ::selection { background: var(--g-band); color: var(--g-text); }

                @keyframes cdcg-pop {
                    from { opacity: 0; transform: translateY(4px) scale(.98); }
                }

                [data-status="approaching"],
                [data-status="loading"] { --g-state: var(--g-near); }
                [data-status="blocked"] { --g-state: var(--g-danger); }
                [data-status="warning"] { --g-state: var(--g-warn); }
                [data-status="off"] { --g-state: var(--g-off); }

                .head {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-height: 28px;
                    padding: 0 8px 0 14px;
                }

                .title {
                    margin: 0;
                    color: var(--g-text);
                    font-size: 14px;
                    font-weight: 600;
                    line-height: 1.3;
                    letter-spacing: -.01em;
                    white-space: nowrap;
                }

                .status {
                    min-width: 0;
                    margin-left: auto;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    color: var(--g-text-2);
                    font-size: 12.5px;
                    white-space: nowrap;
                }

                .status-dot {
                    width: 7px;
                    height: 7px;
                    flex: 0 0 7px;
                    border-radius: 50%;
                    background: var(--g-state);
                }

                .panel[data-status="blocked"] .status { color: var(--g-danger); }

                .icon-button {
                    width: 28px;
                    height: 28px;
                    flex: 0 0 28px;
                    display: grid;
                    place-items: center;
                    padding: 0;
                    border: 0;
                    border-radius: 8px;
                    background: transparent;
                    color: var(--g-text-2);
                    cursor: pointer;
                    transition: background 140ms ease, color 140ms ease;
                }

                .icon-button:hover { background: var(--g-hover); color: var(--g-text); }
                .icon-button:focus-visible { outline: 2px solid var(--g-focus); outline-offset: 0; }
                .icon-button svg { width: 16px; height: 16px; }

                .gauge {
                    position: relative;
                    height: 4px;
                    flex: none;
                    margin: 12px 14px 0;
                    border-radius: 2px;
                    background: var(--g-control);
                }

                .gauge-band {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: var(--band-left, 60%);
                    width: var(--band-width, 30%);
                    background: var(--g-band);
                }

                .gauge-fill {
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    background: var(--g-state);
                    transform: scaleX(var(--fill-scale, 0));
                    transform-origin: 0 50%;
                    transition: transform 240ms cubic-bezier(.16, 1, .3, 1), background 160ms ease;
                }

                .gauge-target {
                    position: absolute;
                    top: -3px;
                    bottom: -3px;
                    left: var(--target-left, 75%);
                    width: 2px;
                    margin-left: -1px;
                    border-radius: 1px;
                    background: var(--g-text);
                }

                .summary,
                .message {
                    margin: 0 14px;
                    color: var(--g-text-2);
                    font-size: 12.5px;
                    line-height: 1.45;
                }

                .summary {
                    margin-top: 9px;
                    font-variant-numeric: tabular-nums;
                }

                .summary b { color: var(--g-text); font-weight: 600; }
                .message { margin-top: 2px; }
                .message:empty { display: none; }

                .divider {
                    height: 1px;
                    flex: none;
                    margin: 12px 0 6px;
                    background: var(--g-line);
                }

                .list {
                    display: flex;
                    flex-direction: column;
                    padding: 0 6px;
                }

                .row {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-height: 40px;
                    padding: 0 8px;
                    border-radius: 8px;
                    color: var(--g-text);
                }

                .row-icon {
                    width: 17px;
                    height: 17px;
                    color: var(--g-text-2);
                }

                .row-label {
                    flex: 1 1 auto;
                    min-width: 0;
                    overflow: hidden;
                    font-size: 14px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                label.row { cursor: pointer; }

                label.row:hover,
                .row-button:hover { background: var(--g-hover); }

                .row-button {
                    width: 100%;
                    border: 0;
                    background: transparent;
                    text-align: left;
                    cursor: pointer;
                    transition: background 140ms ease;
                }

                .row-button:focus-visible { outline: 2px solid var(--g-focus); outline-offset: -2px; }

                .row-meta {
                    flex: none;
                    color: var(--g-text-3);
                    font-size: 12.5px;
                    font-variant-numeric: tabular-nums;
                }

                .row-button[aria-busy="true"] .row-icon { animation: cdcg-spin 900ms linear infinite; }

                @keyframes cdcg-spin {
                    to { transform: rotate(360deg); }
                }

                .switch-input {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: 0;
                    opacity: 0;
                    pointer-events: none;
                }

                .switch {
                    position: relative;
                    width: 36px;
                    height: 20px;
                    flex: 0 0 36px;
                    border-radius: 999px;
                    background: var(--g-switch-off);
                    transition: background 160ms ease;
                }

                .switch::after {
                    content: "";
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: var(--g-thumb);
                    box-shadow: 0 1px 2px rgba(0, 0, 0, .24);
                    transition: transform 180ms cubic-bezier(.16, 1, .3, 1);
                }

                .switch-input:checked + .switch { background: var(--g-switch-on); }
                .switch-input:checked + .switch::after { transform: translateX(16px); }
                .switch-input:focus-visible + .switch { outline: 2px solid var(--g-focus); outline-offset: 2px; }

                .stepper {
                    height: 32px;
                    flex: none;
                    display: flex;
                    align-items: center;
                    overflow: hidden;
                    border: 1px solid var(--g-line);
                    border-radius: 8px;
                    background: var(--g-control);
                    transition: border-color 140ms ease, box-shadow 140ms ease;
                }

                .stepper:focus-within {
                    border-color: var(--g-text-3);
                    box-shadow: 0 0 0 2px var(--g-focus);
                }

                .stepper[data-invalid="true"] { border-color: var(--g-danger); }

                .step {
                    width: 30px;
                    height: 100%;
                    display: grid;
                    place-items: center;
                    padding: 0;
                    border: 0;
                    background: transparent;
                    color: var(--g-text-2);
                    cursor: pointer;
                    transition: background 120ms ease, color 120ms ease;
                }

                .step:hover,
                .step:focus-visible { outline: none; background: var(--g-hover); color: var(--g-text); }
                .step:active svg { transform: scale(.86); }
                .step svg { width: 14px; height: 14px; }

                .step-input {
                    width: 60px;
                    height: 100%;
                    padding: 0;
                    border: 0;
                    outline: none;
                    background: transparent;
                    color: var(--g-text);
                    caret-color: var(--g-caret);
                    font-size: 14px;
                    font-variant-numeric: tabular-nums;
                    text-align: center;
                }

                .step-prefix {
                    padding-left: 6px;
                    color: var(--g-text-3);
                    font-size: 13px;
                }

                .step-prefix + .step-input {
                    width: 46px;
                    padding-left: 2px;
                    text-align: left;
                }

                .validation {
                    margin: 2px 14px 4px;
                    color: var(--g-danger);
                    font-size: 12px;
                    line-height: 1.4;
                }

                .validation:empty { display: none; }

                .toast {
                    width: min(292px, calc(100vw - 16px));
                    display: none;
                    align-self: flex-end;
                    align-items: flex-start;
                    gap: 8px;
                    padding: 9px 12px;
                    border: 1px solid var(--g-line);
                    border-radius: 10px;
                    background-color: var(--g-surface);
                    background-image: var(--g-surface-image);
                    -webkit-backdrop-filter: var(--g-backdrop);
                    backdrop-filter: var(--g-backdrop);
                    box-shadow: var(--g-shadow);
                    color: var(--g-text);
                    font-size: 13px;
                    line-height: 1.45;
                }

                .toast::before {
                    content: "";
                    width: 7px;
                    height: 7px;
                    flex: 0 0 7px;
                    margin-top: 6px;
                    border-radius: 50%;
                    background: var(--g-text-3);
                }

                .toast[data-visible="true"] {
                    display: flex;
                    animation: cdcg-pop 180ms cubic-bezier(.16, 1, .3, 1);
                }

                .toast[data-kind="ok"]::before { background: var(--g-safe); }
                .toast[data-kind="blocked"]::before,
                .toast[data-kind="error"]::before { background: var(--g-danger); }

                @media (pointer: coarse) {
                    .row { min-height: 44px; }
                    .stepper { height: 36px; }
                    .step { width: 36px; }
                    .icon-button { width: 36px; height: 36px; flex-basis: 36px; }
                }

                @media (max-width: 520px) {
                    .pill-label { font-size: 10px; }
                }

                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after {
                        animation: none !important;
                        transition: none !important;
                    }
                }
            </style>
            <div class="dock">
                <div class="toast" role="status" aria-live="polite"></div>
                <section class="panel" role="dialog" aria-labelledby="cdcg-title" tabindex="-1" hidden>
                    <header class="head">
                        <h2 class="title" id="cdcg-title">크래커 가드</h2>
                        <span class="status"><span class="status-dot" aria-hidden="true"></span><span class="status-text">확인 중</span></span>
                        <button class="icon-button" type="button" data-action="close" aria-label="설정 닫기">${icon('close')}</button>
                    </header>
                    <div class="gauge" aria-hidden="true"><span class="gauge-band"></span><span class="gauge-fill"></span><span class="gauge-target"></span></div>
                    <p class="summary"></p>
                    <p class="message"></p>
                    <div class="divider" role="presentation"></div>
                    <div class="list">
                        <label class="row">
                            ${icon('shield', 'row-icon')}
                            <span class="row-label">감시</span>
                            <input class="switch-input" type="checkbox" role="switch" data-field="enabled">
                            <span class="switch" aria-hidden="true"></span>
                        </label>
                        <div class="row">
                            ${icon('target', 'row-icon')}
                            <label class="row-label" for="cdcg-limit">일일 목표</label>
                            <div class="stepper" data-stepper="limit">
                                <button class="step" type="button" data-step="limit" data-dir="-1" aria-label="일일 목표 줄이기">${icon('minus')}</button>
                                <input class="step-input" id="cdcg-limit" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="12" aria-describedby="cdcg-validation">
                                <button class="step" type="button" data-step="limit" data-dir="1" aria-label="일일 목표 늘리기">${icon('plus')}</button>
                            </div>
                        </div>
                        <div class="row">
                            ${icon('range', 'row-icon')}
                            <label class="row-label" for="cdcg-margin">허용 오차</label>
                            <div class="stepper" data-stepper="margin">
                                <button class="step" type="button" data-step="margin" data-dir="-1" aria-label="허용 오차 줄이기">${icon('minus')}</button>
                                <span class="step-prefix" aria-hidden="true">±</span>
                                <input class="step-input" id="cdcg-margin" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="12" aria-describedby="cdcg-validation">
                                <button class="step" type="button" data-step="margin" data-dir="1" aria-label="허용 오차 늘리기">${icon('plus')}</button>
                            </div>
                        </div>
                        <label class="row">
                            ${icon('repeat', 'row-icon')}
                            <span class="row-label">재생성도 막기</span>
                            <input class="switch-input" type="checkbox" role="switch" data-field="regeneration">
                            <span class="switch" aria-hidden="true"></span>
                        </label>
                    </div>
                    <p class="validation" id="cdcg-validation" role="alert"></p>
                    <div class="divider" role="presentation"></div>
                    <div class="list">
                        <button class="row row-button" type="button" data-action="refresh">
                            ${icon('refresh', 'row-icon')}
                            <span class="row-label">지금 확인</span>
                            <span class="row-meta" data-updated>아직 확인 전</span>
                        </button>
                    </div>
                </section>

                <button class="pill" type="button" aria-haspopup="dialog" aria-expanded="false">
                    <span class="pill-copy">
                        <span class="pill-status">
                            <span class="dot" aria-hidden="true"></span>
                            <span class="pill-summary">확인 중</span>
                        </span>
                        <span class="pill-label">크래커 가드</span>
                    </span>
                </button>
            </div>
        `;
        document.body.appendChild(host);

        ui.host = host;
        ui.shadow = shadow;
        ui.pill = shadow.querySelector('.pill');
        ui.pillText = shadow.querySelector('.pill-summary');
        ui.panel = shadow.querySelector('.panel');
        ui.statusText = shadow.querySelector('.status-text');
        ui.gauge = shadow.querySelector('.gauge');
        ui.summary = shadow.querySelector('.summary');
        ui.message = shadow.querySelector('.message');
        ui.enabledInput = shadow.querySelector('[data-field="enabled"]');
        ui.regenerationInput = shadow.querySelector('[data-field="regeneration"]');
        ui.limitInput = shadow.querySelector('#cdcg-limit');
        ui.marginInput = shadow.querySelector('#cdcg-margin');
        ui.validation = shadow.querySelector('.validation');
        ui.refreshButton = shadow.querySelector('[data-action="refresh"]');
        ui.updatedValue = shadow.querySelector('[data-updated]');
        ui.toast = shadow.querySelector('.toast');

        ui.pill.addEventListener('click', (event) => {
            setPanelOpen(!state.panelOpen, { focus: event.detail === 0 });
        });
        shadow.querySelector('[data-action="close"]').addEventListener('click', () => {
            setPanelOpen(false);
            ui.pill.focus({ preventScroll: true });
        });
        ui.refreshButton.addEventListener('click', () => refreshUsage({
            announce: true,
            force: true,
            activeOnly: false,
        }));
        ui.enabledInput.addEventListener('change', () => {
            saveConfig({ ...config, enabled: ui.enabledInput.checked });
        });
        ui.regenerationInput.addEventListener('change', () => {
            saveConfig({ ...config, blockRegeneration: ui.regenerationInput.checked });
        });
        for (const button of shadow.querySelectorAll('[data-step]')) {
            button.addEventListener('click', () => {
                stepNumberField(button.dataset.step, Number(button.dataset.dir));
            });
        }
        bindNumberInput('limit', ui.limitInput);
        bindNumberInput('margin', ui.marginInput);

        // 설정창 안에서 누른 키가 크랙 단축키(Enter=입력창 이동, Esc=요약 메모리 등)로 새지 않게 막는다.
        // 조합키는 그대로 보내 크랙의 눌림 상태 추적이 어긋나지 않게 한다.
        shadow.addEventListener('keydown', handleShadowKeydown);
        shadow.addEventListener('keyup', stopKeyLeak);
        shadow.addEventListener('keypress', stopKeyLeak);

        syncFormFromConfig();
        render();
    }

    function getPageTheme() {
        const root = document.documentElement;
        const themed = String(root.dataset.sgbTheme || '').toLowerCase();
        if (themed === 'light' || themed === 'dark') return themed;
        // 크랙은 다크/라이트 표시를 html이 아니라 body[data-theme]에 둔다.
        const crack = String(
            document.body?.dataset.theme
            || root.dataset.crackTheme
            || root.dataset.theme
            || '',
        ).toLowerCase();
        if (crack === 'light' || crack === 'dark') return crack;
        return root.classList.contains('dark') ? 'dark' : 'light';
    }

    function syncTheme() {
        if (!ui.host) return;
        const theme = getPageTheme();
        if (ui.host.dataset.theme !== theme) ui.host.dataset.theme = theme;
    }

    function startThemeObserver() {
        if (themeObserver) return;
        themeObserver = new MutationObserver(() => {
            syncTheme();
            scheduleUiAttachment();
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
                'class',
                'data-theme',
                'data-crack-theme',
                'data-sgb-theme',
                'data-sgb-profile',
            ],
        });
        if (document.body) {
            themeObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['data-theme'],
            });
        }
    }

    function findUiInlineHost() {
        const editor = getVisibleChatEditor();
        if (!(editor instanceof HTMLElement)) return null;

        // 라디오존데가 이미 찾은 입력 호스트가 있으면 같은 부모를 그대로 공유한다.
        const radiosonde = document.getElementById('igx-live-popup');
        const radiosondeHost = radiosonde?.parentElement;
        if (
            radiosonde instanceof HTMLElement
            && radiosonde.matches('[data-igx-stable-inline-host="1"]')
            && radiosondeHost instanceof HTMLElement
            && radiosondeHost !== document.body
            && radiosondeHost !== document.documentElement
            && radiosondeHost.matches('[data-sgb-input-host], .igx-inline-overlay-host')
            && radiosondeHost.contains(editor)
            && isVisibleElement(radiosondeHost)
        ) return radiosondeHost;

        // SGB와 라디오존데가 표시한 검증된 입력 호스트를 최우선으로 사용한다.
        const markedHost = editor.closest(
            '[data-sgb-input-host], .igx-inline-overlay-host',
        );
        if (markedHost instanceof HTMLElement && isVisibleElement(markedHost)) {
            return markedHost;
        }

        // 순정 Crack의 현재 입력 영역 바깥 호스트.
        const crackHost = editor.closest(
            'div[class*="bg-bg_screen"][class*="pointer-events-auto"]',
        );
        if (crackHost instanceof HTMLElement && isVisibleElement(crackHost)) {
            return crackHost;
        }

        // 마지막 폴백도 입력 박스 자체보다 한 단계 바깥 래퍼를 먼저 고른다.
        const wrapper = editor.closest('div.flex.w-full.flex-col.rounded-lg.border')
            || editor.closest('div.flex.w-full.flex-col.rounded-lg')
            || editor.closest('div[class*="rounded"][class*="border"]')
            || editor.closest('form')
            || editor.parentElement;
        const candidates = [
            wrapper?.parentElement,
            wrapper,
            wrapper?.parentElement?.parentElement,
        ];
        const viewportWidth = window.innerWidth || 1;
        const editorRect = editor.getBoundingClientRect();
        const maxReasonableWidth = Math.min(
            viewportWidth * 0.9,
            Math.max(editorRect.width * 1.55, editorRect.width + 220),
        );

        for (const candidate of candidates) {
            if (!(candidate instanceof HTMLElement)) continue;
            if (!candidate.contains(editor)) continue;
            if (candidate === document.body || candidate === document.documentElement) continue;
            if (candidate.closest(
                '[role="dialog"], [aria-modal="true"], [data-sidebar="sidebar"]',
            )) continue;
            if (!isVisibleElement(candidate)) continue;
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            const clipsPopup = [style.overflowX, style.overflowY]
                .some((value) => /^(hidden|clip|auto|scroll)$/.test(value));
            if (rect.width < 180 || rect.height < 28) continue;
            if (rect.width > viewportWidth * 0.99 || rect.width > maxReasonableWidth) continue;
            const clipPath = style.clipPath || 'none';
            const maskImage = style.maskImage || style.webkitMaskImage || 'none';
            if (clipsPopup || String(style.contain || '').includes('paint')) continue;
            if (clipPath !== 'none' || maskImage !== 'none') continue;
            return candidate;
        }

        return null;
    }

    function findLowestCommonAncestor(first, second) {
        if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return null;
        const firstAncestors = new Set();
        for (let node = first; node; node = node.parentElement) firstAncestors.add(node);
        for (let node = second; node; node = node.parentElement) {
            if (firstAncestors.has(node)) return node;
        }
        return null;
    }

    function getDirectChildUnder(ancestor, descendant) {
        if (!(ancestor instanceof HTMLElement) || !(descendant instanceof HTMLElement)) return null;
        let node = descendant;
        while (node.parentElement && node.parentElement !== ancestor) node = node.parentElement;
        return node.parentElement === ancestor ? node : null;
    }

    function findUiMountContext(anchorHost) {
        if (!(anchorHost instanceof HTMLElement)) return null;

        const sidePanels = document.querySelectorAll(
            'div[class*="border-l"][class*="right-0"][class*="h-full"][class*="overflow-hidden"]',
        );
        let bestContext = null;
        let bestDepth = Number.POSITIVE_INFINITY;

        for (const sidePanel of sidePanels) {
            if (!(sidePanel instanceof HTMLElement) || anchorHost.contains(sidePanel)) continue;
            if (sidePanel.closest('[role="dialog"], [aria-modal="true"]')) continue;
            const common = findLowestCommonAncestor(anchorHost, sidePanel);
            if (!(common instanceof HTMLElement)) continue;
            if (common === document.body || common === document.documentElement) continue;

            const style = window.getComputedStyle(common);
            const rect = common.getBoundingClientRect();
            if (style.position === 'static' || rect.width < anchorHost.offsetWidth) continue;
            if (rect.height < Math.min(280, window.innerHeight * 0.5)) continue;

            let depth = 0;
            for (let node = anchorHost; node && node !== common; node = node.parentElement) depth += 1;
            if (depth > 10) continue;
            if (depth >= bestDepth) continue;

            let before = getDirectChildUnder(common, sidePanel);
            const dimLayer = before?.previousElementSibling;
            if (
                dimLayer instanceof HTMLElement
                && String(dimLayer.className).includes('bg-bg_dimmed')
            ) before = dimLayer;

            bestContext = { parent: common, before };
            bestDepth = depth;
        }

        if (bestContext) return bestContext;

        // 사이드 패널 선택자가 바뀌어도 전체 높이의 positioned 채팅 셸 안에는 남는다.
        const anchorRect = anchorHost.getBoundingClientRect();
        const minShellHeight = Math.min(360, window.innerHeight * 0.55);
        let ancestor = anchorHost.parentElement;
        for (let depth = 0; ancestor && depth < 10; depth += 1, ancestor = ancestor.parentElement) {
            if (ancestor === document.body || ancestor === document.documentElement) break;
            if (ancestor.closest('[role="dialog"], [aria-modal="true"]')) continue;
            const style = window.getComputedStyle(ancestor);
            const rect = ancestor.getBoundingClientRect();
            if (style.position === 'static') continue;
            if (rect.width + 2 < anchorRect.width || rect.height < minShellHeight) continue;
            return { parent: ancestor, before: null };
        }

        // 라디오존데처럼 호스트 자체가 원래 positioned 상태일 때만 최종 폴백으로 쓴다.
        return window.getComputedStyle(anchorHost).position !== 'static'
            ? { parent: anchorHost, before: null }
            : null;
    }

    function scheduleUiAttachment() {
        if (uiGeometryFrame !== null) return;
        uiGeometryFrame = window.requestAnimationFrame(() => {
            uiGeometryFrame = null;
            attachUiAboveComposer();
        });
    }

    function bindUiGeometryObserver(anchorHost, mountParent, radiosonde) {
        currentUiRadiosonde = radiosonde instanceof HTMLElement ? radiosonde : null;
        if (typeof ResizeObserver !== 'function') return;
        if (!uiResizeObserver) {
            uiResizeObserver = new ResizeObserver(scheduleUiAttachment);
        }
        uiResizeObserver.disconnect();
        uiResizeObserver.observe(anchorHost);
        if (mountParent !== anchorHost) uiResizeObserver.observe(mountParent);
        // 라디오존데 줄이 두 줄로 접히거나 접혔다 펴질 때도 가드가 그 위를 따라간다.
        if (currentUiRadiosonde) uiResizeObserver.observe(currentUiRadiosonde);
    }

    function detachUiInlineHost() {
        releaseGuardReservedSpace();
        uiResizeObserver?.disconnect();
        if (uiGeometryFrame !== null) {
            window.cancelAnimationFrame(uiGeometryFrame);
            uiGeometryFrame = null;
        }
        currentUiInlineHost = null;
        currentUiMountParent = null;
        currentUiRadiosonde = null;
    }

    function releaseGuardReservedSpace() {
        const host = currentReservedHost;
        currentReservedHost = null;
        if (!(host instanceof HTMLElement)) return;
        host.removeAttribute('data-cdcg-guard-space');
        host.style.removeProperty('--cdcg-base-padding-top');
        host.style.removeProperty('--cdcg-radio-base-top');
        host.style.removeProperty('--cdcg-guard-reserve');
    }

    // 단독 라디오존데는 입력창 호스트 맨 위(top 6px)에 absolute로 겹쳐 그려서 그 위에 가드 자리가 없다.
    // 이때만 호스트를 가드 한 줄만큼 늘리고 라디오존데를 같이 내린다.
    function syncGuardReservedSpace(reserveHost, radiosonde) {
        if (currentReservedHost !== reserveHost) releaseGuardReservedSpace();
        if (!(reserveHost instanceof HTMLElement) || !(radiosonde instanceof HTMLElement)) return;
        currentReservedHost = reserveHost;
        if (reserveHost.hasAttribute('data-cdcg-guard-space')) return;
        const basePaddingTop = Number.parseFloat(window.getComputedStyle(reserveHost).paddingTop) || 0;
        const radioBaseTop = Number.parseFloat(window.getComputedStyle(radiosonde).top);
        reserveHost.style.setProperty('--cdcg-base-padding-top', `${basePaddingTop}px`);
        reserveHost.style.setProperty('--cdcg-radio-base-top', `${Number.isFinite(radioBaseTop) ? radioBaseTop : 6}px`);
        reserveHost.style.setProperty('--cdcg-guard-reserve', `${GUARD_PILL_HEIGHT + GUARD_STACK_GAP}px`);
        reserveHost.setAttribute('data-cdcg-guard-space', '1');
    }

    // 입력 박스(테두리 있는 둥근 상자). 가드 줄의 좌우 폭과 배경 톤의 기준이다.
    function getComposerSurface(host) {
        const editor = getVisibleChatEditor(host) || getVisibleChatEditor();
        if (!(editor instanceof HTMLElement)) return null;
        const surface = editor.closest('[data-sgb-input-box], [data-cmu-theme-input-box]')
            || editor.closest('div.flex.w-full.flex-col.rounded-lg.border')
            || editor.closest('div[class*="rounded"][class*="border"]')
            || getComposerFromEditor(editor);
        return surface instanceof HTMLElement && host.contains(surface) ? surface : null;
    }

    // 입력 박스에 딸린 라디오존데 줄. 허브는 입력 박스 바로 앞 흐름 요소로,
    // 단독 라디오존데는 호스트 안 absolute 막대로 붙지만 둘 다 입력 박스를 품은 부모 아래에 있다.
    // 숨겨져 있어도 돌려준다: 다시 보일 때 크기 감시로 가드를 제자리에 올리기 위해서다.
    function getComposerRadiosonde(surface) {
        const popup = document.getElementById('igx-live-popup');
        if (!(popup instanceof HTMLElement)) return null;
        const parent = popup.parentElement;
        if (!(parent instanceof HTMLElement) || parent === document.body || parent === document.documentElement) return null;
        return parent.contains(surface) && !surface.contains(popup) ? popup : null;
    }

    // 가드는 입력창 묶음(라디오존데·추천 답변 줄·입력 박스)의 가장 위 줄보다 한 칸 위에 선다.
    function measureComposerStackTop(host, surface, radiosonde) {
        let top = surface.getBoundingClientRect().top;
        if (radiosonde) top = Math.min(top, radiosonde.getBoundingClientRect().top);
        const branch = surface === host ? null : getDirectChildUnder(host, surface);
        if (!branch) return top;
        for (const child of host.children) {
            if (child === branch) break;
            if (!(child instanceof HTMLElement) || child === radiosonde) continue;
            const position = window.getComputedStyle(child).position;
            if (position === 'absolute' || position === 'fixed') continue;
            if (isVisibleElement(child)) top = Math.min(top, child.getBoundingClientRect().top);
        }
        return top;
    }

    function setUiHostVar(name, value) {
        if (ui.host && ui.host.style.getPropertyValue(name) !== value) ui.host.style.setProperty(name, value);
    }

    function syncInlineThemeFromComposer(surface) {
        if (!ui.host) return;
        const source = surface instanceof HTMLElement
            ? surface
            : (getVisibleComposer() || getVisibleChatEditor());
        if (!(source instanceof HTMLElement)) return;
        const style = window.getComputedStyle(source);
        const backgroundColor = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? style.backgroundColor
            : (getPageTheme() === 'dark' ? 'rgba(24, 24, 27, .76)' : 'rgba(250, 250, 250, .82)');
        const backdrop = style.backdropFilter || style.webkitBackdropFilter || 'none';
        setUiHostVar('--cdcg-inline-bg-color', backgroundColor);
        setUiHostVar('--cdcg-inline-bg-image', style.backgroundImage || 'none');
        setUiHostVar('--cdcg-inline-border', style.borderTopColor || style.borderColor || 'transparent');
        setUiHostVar('--cdcg-inline-radius', style.borderRadius || '6px');
        setUiHostVar('--cdcg-inline-backdrop', backdrop);
        // 테마 확프가 꾸민 입력창이면 설정창도 그 바탕을 따른다. 뒤 글자가 비치지 않게 불투명도와 흐림을 보탠다.
        const skin = source.matches('[data-sgb-input-box], [data-cmu-theme-input-box]') ? 'composer' : 'crack';
        if (ui.host.dataset.skin !== skin) ui.host.dataset.skin = skin;
        setUiHostVar('--cdcg-panel-bg', withMinimumAlpha(backgroundColor, 0.86));
        setUiHostVar('--cdcg-panel-backdrop', backdrop !== 'none' ? backdrop : 'blur(16px)');
    }

    function withMinimumAlpha(color, minimum) {
        const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i
            .exec(String(color).trim());
        if (!match) return color;
        let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
        if (match[5] === '%') alpha /= 100;
        return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${Math.max(alpha, minimum)})`;
    }

    function hideGuardUi() {
        detachUiInlineHost();
        collapsePanel();
        if (ui.host) {
            ui.host.hidden = true;
            if (document.body && ui.host.parentNode !== document.body) {
                document.body.appendChild(ui.host);
            }
        }
    }

    function attachUiAboveComposer() {
        if (!ui.host) return false;
        const nextHost = findUiInlineHost();

        if (!nextHost) {
            hideGuardUi();
            return false;
        }

        const mountContext = findUiMountContext(nextHost);
        const nextMountParent = mountContext?.parent;
        if (!(nextMountParent instanceof HTMLElement)) {
            hideGuardUi();
            return false;
        }

        const contextChanged = currentUiInlineHost !== nextHost
            || currentUiMountParent !== nextMountParent;
        if (contextChanged) detachUiInlineHost();

        currentUiInlineHost = nextHost;
        currentUiMountParent = nextMountParent;

        const before = mountContext.before instanceof HTMLElement
            && mountContext.before.parentElement === nextMountParent
            ? mountContext.before
            : null;
        const hostAlreadyBefore = before
            ? Boolean(
                ui.host.parentElement === nextMountParent
                && (ui.host.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING),
            )
            : ui.host.parentElement === nextMountParent;

        if (!hostAlreadyBefore) {
            collapsePanel();
            ui.host.hidden = true;
            if (before) nextMountParent.insertBefore(ui.host, before);
            else nextMountParent.appendChild(ui.host);
        }

        const surface = getComposerSurface(nextHost) || nextHost;
        const attachedRadiosonde = getComposerRadiosonde(surface);
        if (contextChanged || currentUiRadiosonde !== attachedRadiosonde) {
            bindUiGeometryObserver(nextHost, nextMountParent, attachedRadiosonde);
        }
        const radiosonde = isVisibleElement(attachedRadiosonde) ? attachedRadiosonde : null;

        // 순정·테마·단독 라디오존데·허브 모두 가드 → (라디오존데) → 입력 박스 순서로 통일한다.
        // 허브 라디오존데와 순정 입력창은 호스트 위 여백(py-4 + gap-4)에 가드가 들어가 레이아웃을 건드리지 않는다.
        let reserveHost = null;
        if (radiosonde && window.getComputedStyle(radiosonde).position === 'absolute') {
            const overlayHost = radiosonde.parentElement;
            const roomAbove = radiosonde.getBoundingClientRect().top - overlayHost.getBoundingClientRect().top;
            if (overlayHost === currentReservedHost || roomAbove < GUARD_PILL_HEIGHT + GUARD_STACK_GAP + 2) {
                reserveHost = overlayHost;
            }
        }
        syncGuardReservedSpace(reserveHost, radiosonde);
        syncInlineThemeFromComposer(surface);

        const mountRect = nextMountParent.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const stackTop = measureComposerStackTop(nextHost, surface, radiosonde);
        const pillBottom = Math.max(GUARD_PILL_HEIGHT + 2, stackTop - GUARD_STACK_GAP);
        const pillTop = pillBottom - GUARD_PILL_HEIGHT;
        const originLeft = mountRect.left + nextMountParent.clientLeft;
        const originTop = mountRect.top + nextMountParent.clientTop;
        const localLeft = surfaceRect.left - originLeft + nextMountParent.scrollLeft;
        const localTop = pillTop - originTop + nextMountParent.scrollTop;

        setUiHostVar('--cdcg-inline-left', `${localLeft}px`);
        setUiHostVar('--cdcg-inline-top', `${localTop}px`);
        setUiHostVar('--cdcg-inline-width', `${surfaceRect.width}px`);

        const toastVisible = state.panelOpen
            && ui.toast?.dataset.visible === 'true';
        const toastReserve = toastVisible
            ? Math.ceil(ui.toast.getBoundingClientRect().height) + 6
            : 0;
        const visibleTop = Math.max(0, mountRect.top);
        setUiHostVar(
            '--cdcg-panel-max-height',
            `${Math.max(120, pillTop - visibleTop - 12 - toastReserve)}px`,
        );
        ui.host.hidden = false;
        if (contextChanged) render();
        return true;
    }

    const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'CapsLock']);

    function stopKeyLeak(event) {
        if (!MODIFIER_KEYS.has(event.key)) event.stopPropagation();
    }

    function handleShadowKeydown(event) {
        if (
            event.key === 'Escape'
            && state.panelOpen
            && !event.defaultPrevented
            && !event.isComposing
        ) {
            event.preventDefault();
            setPanelOpen(false, { commit: false });
            ui.pill?.focus({ preventScroll: true });
        }
        stopKeyLeak(event);
    }

    function handleOutsidePointer(event) {
        if (!state.panelOpen || !ui.host) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(ui.host)) return;
        setPanelOpen(false);
    }

    // 위치를 다시 잡거나 숨길 때처럼 설정창만 조용히 닫는다. 위치 재계산을 다시 부르지 않는다.
    function collapsePanel() {
        state.panelOpen = false;
        if (ui.panel) ui.panel.hidden = true;
        if (ui.pill) ui.pill.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', handleOutsidePointer, true);
    }

    function setPanelOpen(open, options = {}) {
        if (!ui.panel || !ui.pill) {
            state.panelOpen = Boolean(open);
            return;
        }
        if (!open) {
            if (state.panelOpen) settlePendingNumbers(options.commit !== false);
            collapsePanel();
            scheduleUiAttachment();
            return;
        }
        state.panelOpen = true;
        ui.panel.hidden = false;
        ui.pill.setAttribute('aria-expanded', 'true');
        syncFormFromConfig();
        render();
        document.addEventListener('pointerdown', handleOutsidePointer, true);
        if (options.focus) ui.enabledInput?.focus({ preventScroll: true });
        scheduleUiAttachment();
    }

    const NUMBER_FIELDS = Object.freeze({
        limit: { key: 'dailyLimit', step: 100, min: 1, max: 10_000_000 },
        margin: { key: 'safetyMargin', step: 50, min: 0, max: 9_999_999 },
    });

    function getNumberInput(name) {
        return name === 'limit' ? ui.limitInput : ui.marginInput;
    }

    function getStepper(name) {
        return ui.shadow?.querySelector(`[data-stepper="${name}"]`) || null;
    }

    // "1,500", "1500개", "±200"처럼 입력해도 숫자만 읽는다.
    function parseCount(text) {
        const digits = String(text ?? '').replace(/[^0-9]/g, '');
        return digits ? Number.parseInt(digits.slice(0, 9), 10) : Number.NaN;
    }

    function getNumberError(dailyLimit, safetyMargin) {
        if (!Number.isFinite(dailyLimit) || dailyLimit < 1) return '일일 목표는 1개 이상으로 입력해 주세요.';
        if (dailyLimit > NUMBER_FIELDS.limit.max) return '일일 목표는 10,000,000개까지 정할 수 있어요.';
        if (!Number.isFinite(safetyMargin) || safetyMargin < 0) return '허용 오차는 0개 이상으로 입력해 주세요.';
        if (safetyMargin >= dailyLimit) return '허용 오차는 일일 목표보다 작아야 해요.';
        return '';
    }

    function showNumberError(name, message) {
        if (!ui.validation) return;
        ui.validation.textContent = message;
        for (const key of Object.keys(NUMBER_FIELDS)) {
            const invalid = key === name;
            getStepper(key)?.setAttribute('data-invalid', String(invalid));
            getNumberInput(key)?.setAttribute('aria-invalid', String(invalid));
        }
    }

    function clearNumberError() {
        if (!ui.validation) return;
        ui.validation.textContent = '';
        for (const key of Object.keys(NUMBER_FIELDS)) {
            getStepper(key)?.removeAttribute('data-invalid');
            getNumberInput(key)?.removeAttribute('aria-invalid');
        }
    }

    function syncNumberInput(name) {
        const input = getNumberInput(name);
        if (input) input.value = formatNumber(config[NUMBER_FIELDS[name].key]);
    }

    function isNumberPending(name) {
        const input = getNumberInput(name);
        return Boolean(input) && parseCount(input.value) !== config[NUMBER_FIELDS[name].key];
    }

    function commitNumberField(name, value) {
        const next = { dailyLimit: config.dailyLimit, safetyMargin: config.safetyMargin };
        next[NUMBER_FIELDS[name].key] = value;
        const message = getNumberError(next.dailyLimit, next.safetyMargin);
        if (message) {
            showNumberError(name, message);
            return false;
        }
        clearNumberError();
        if (next.dailyLimit !== config.dailyLimit || next.safetyMargin !== config.safetyMargin) {
            saveConfig({ ...config, ...next });
        }
        syncNumberInput(name);
        return true;
    }

    function commitTypedNumber(name) {
        const input = getNumberInput(name);
        if (!input) return false;
        const value = parseCount(input.value);
        if (!Number.isFinite(value)) {
            showNumberError(name, name === 'limit'
                ? '일일 목표는 1개 이상으로 입력해 주세요.'
                : '허용 오차는 0개 이상으로 입력해 주세요.');
            return false;
        }
        return commitNumberField(name, value);
    }

    function stepNumberField(name, direction) {
        const field = NUMBER_FIELDS[name];
        if (!field) return;
        const typed = parseCount(getNumberInput(name)?.value);
        const base = Number.isFinite(typed) ? typed : config[field.key];
        // 1,037에서 +는 1,100, -는 1,000처럼 단위에 맞춰 움직인다.
        const stepped = direction > 0
            ? (Math.floor(base / field.step) + 1) * field.step
            : (Math.ceil(base / field.step) - 1) * field.step;
        const min = name === 'limit' ? Math.max(field.min, config.safetyMargin + 1) : field.min;
        const max = name === 'limit' ? field.max : Math.min(field.max, config.dailyLimit - 1);
        const value = Math.min(max, Math.max(min, stepped));
        if (value === config[field.key]) {
            if (value !== stepped && name === 'limit' && direction < 0) {
                showNumberError(name, '일일 목표는 허용 오차보다 커야 해요. 오차를 먼저 줄여 주세요.');
            } else if (value !== stepped && name === 'margin' && direction > 0) {
                showNumberError(name, '허용 오차는 일일 목표보다 작아야 해요.');
            } else {
                clearNumberError();
            }
            syncNumberInput(name);
            return;
        }
        commitNumberField(name, value);
    }

    function bindNumberInput(name, input) {
        input.addEventListener('focus', () => {
            window.requestAnimationFrame(() => {
                if (ui.shadow?.activeElement === input) input.select();
            });
        });
        input.addEventListener('keydown', (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                commitTypedNumber(name);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                stepNumberField(name, event.key === 'ArrowUp' ? 1 : -1);
            } else if (event.key === 'Escape' && isNumberPending(name)) {
                // 입력 중인 값만 되돌리고, 한 번 더 누르면 설정창을 닫는다.
                event.preventDefault();
                syncNumberInput(name);
                clearNumberError();
            }
        });
        input.addEventListener('change', () => commitTypedNumber(name));
        input.addEventListener('blur', () => {
            if (getStepper(name)?.dataset.invalid !== 'true') return;
            const message = ui.validation?.textContent || '';
            syncNumberInput(name);
            clearNumberError();
            if (message && ui.validation) ui.validation.textContent = `${message} 이전 값으로 되돌렸어요.`;
        });
    }

    // 닫을 때 입력칸에 남은 값을 적용하거나(Esc면) 버린다.
    function settlePendingNumbers(commit) {
        for (const name of Object.keys(NUMBER_FIELDS)) {
            if (!isNumberPending(name)) continue;
            if (commit && !commitTypedNumber(name)) {
                const message = ui.validation?.textContent || '';
                if (message) showToast(`${message} 이전 값을 그대로 둘게요.`, 'error');
            }
            syncNumberInput(name);
        }
        clearNumberError();
    }

    function syncFormFromConfig() {
        if (!ui.enabledInput) return;
        ui.enabledInput.checked = config.enabled;
        ui.regenerationInput.checked = config.blockRegeneration;
        for (const name of Object.keys(NUMBER_FIELDS)) {
            if (ui.shadow?.activeElement !== getNumberInput(name)) syncNumberInput(name);
        }
        clearNumberError();
    }

    function render() {
        if (!ui.host) return;
        const decision = getBudgetDecision();
        const { range } = decision;
        const blockReason = getBlockReason();
        const used = Math.max(0, Number(state.used) || 0);
        const usedText = formatNumber(used);
        const targetText = formatNumber(range.target);
        const rangeText = `${formatNumber(range.lower)}~${formatNumber(range.upper)}`;
        const remainingToRange = Math.max(0, range.lower - used);

        let status = 'safe';
        let statusText = '전송 가능';
        let pillSummary = `오늘 ${usedText} / ${targetText}`;
        let message = remainingToRange > 0
            ? `${formatNumber(remainingToRange)}개 더 쓰면 멈춤 구간에 들어가요.`
            : `멈춤 구간 ${rangeText}개 안이에요.`;

        if (decision.phase === 'approaching-target' && decision.predicted) {
            status = 'approaching';
            statusText = '한 번 더 가능';
            message = `최근 1회 ${formatNumber(decision.estimate)}개 기준, 다음엔 ${formatNumber(decision.predicted)}개로 목표에 더 가까워져요.`;
        }

        if (!config.enabled) {
            status = 'off';
            statusText = '감시 꺼짐';
            pillSummary = `감시 꺼짐 · 오늘 ${usedText} / ${targetText}`;
            message = '사용량만 보여주고 전송은 막지 않아요.';
        } else if (blockReason) {
            const waiting = state.loading && !state.lastUpdatedAt;
            status = 'blocked';
            statusText = waiting ? '확인 중' : '전송 차단됨';
            pillSummary = waiting ? '사용량 확인 중 · 전송 대기' : `차단됨 · 오늘 ${usedText} / ${targetText}`;
            message = blockReason;
        } else if (state.loading) {
            status = 'loading';
            statusText = '확인 중';
            pillSummary = `갱신 중 · 오늘 ${usedText} / ${targetText}`;
            message = '최신 사용 내역을 확인하고 있어요.';
        } else if (state.error) {
            status = 'warning';
            statusText = '확인 필요';
            pillSummary = `확인 필요 · 오늘 ${usedText} / ${targetText}`;
            message = state.error;
        }

        ui.pill.dataset.status = status;
        ui.pillText.textContent = pillSummary;
        ui.panel.dataset.status = status;
        ui.statusText.textContent = statusText;

        // 게이지 끝은 상한의 1.1배. 상한을 넘겨 쓰면 그만큼 늘려 넘친 양이 보이게 한다.
        const scaleMax = Math.max(1, range.upper * 1.1, used * 1.02);
        const toPercent = (value) => `${Math.min(100, Math.max(0, (value / scaleMax) * 100)).toFixed(2)}%`;
        ui.gauge.style.setProperty('--band-left', toPercent(range.lower));
        ui.gauge.style.setProperty('--band-width', toPercent(range.upper - range.lower));
        ui.gauge.style.setProperty('--target-left', toPercent(range.target));
        ui.gauge.style.setProperty('--fill-scale', Math.min(1, Math.max(0, used / scaleMax)).toFixed(4));

        const usedStrong = document.createElement('b');
        usedStrong.textContent = usedText;
        ui.summary.replaceChildren('오늘 ', usedStrong, ` · 목표 ${targetText} · 멈춤 ${rangeText}`);
        ui.message.textContent = message;

        ui.updatedValue.textContent = state.lastUpdatedAt
            ? `${formatTime(state.lastUpdatedAt)} · ${state.error ? '확인 실패' : `${formatNumber(state.recordCount)}건`}`
            : (state.loading ? '확인 중…' : '아직 확인 전');
        ui.refreshButton.setAttribute('aria-busy', String(state.loading));
    }

    function showToast(message, kind = 'info') {
        if (!ui.toast) return;
        window.clearTimeout(toastTimer);
        ui.toast.textContent = message;
        ui.toast.dataset.kind = kind;
        ui.toast.dataset.visible = 'true';
        scheduleUiAttachment();
        toastTimer = window.setTimeout(() => {
            if (ui.toast) {
                ui.toast.dataset.visible = 'false';
                scheduleUiAttachment();
            }
        }, kind === 'blocked' ? 5_000 : 3_500);
    }

    function startComposerObserver() {
        if (composerObserver || !document.body) return;
        composerObserver = new MutationObserver((mutations) => {
            if (!mutations.some(mutationTouchesComposer)) return;
            window.clearTimeout(composerUpdateTimer);
            composerUpdateTimer = window.setTimeout(() => {
                attachUiAboveComposer();
                syncComposerButton();
                syncTheme();
            }, 120);
        });
        composerObserver.observe(document.body, { childList: true, subtree: true });
    }

    function handleStorage(event) {
        if (event.key !== CONFIG_KEY) return;
        config = loadConfig();
        syncFormFromConfig();
        render();
        syncComposerButton();
    }

    function stopRefreshTimer() {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    function scheduleNextRefresh(delay = REFRESH_INTERVAL_MS) {
        stopRefreshTimer();
        if (!isChatPage() || document.visibilityState !== 'visible') return;
        refreshTimer = window.setTimeout(() => {
            refreshTimer = null;
            refreshUsage();
        }, Math.max(250, delay));
    }

    function startRefreshLoop() {
        scheduleNextRefresh();
    }

    function scheduleResumeRefresh() {
        window.clearTimeout(resumeTimer);
        resumeTimer = window.setTimeout(() => {
            resumeTimer = null;
            observedPathname = window.location.pathname;
            scheduleUiAttachment();
            if (isChatPage() && document.visibilityState === 'visible') refreshUsage();
            else stopRefreshTimer();
        }, RESUME_DEBOUNCE_MS);
    }

    function startUiPositionLoop() {
        window.clearInterval(uiPositionTimer);
        uiPositionTimer = window.setInterval(() => {
            const pathChanged = observedPathname !== window.location.pathname;
            if (pathChanged) {
                observedPathname = window.location.pathname;
                if (isChatPage() && document.visibilityState === 'visible') refreshUsage();
                else stopRefreshTimer();
            }

            const mountBroken = !ui.host?.isConnected
                || (isChatPage() && (
                    !(currentUiInlineHost instanceof HTMLElement)
                    || !currentUiInlineHost.isConnected
                    || !(currentUiMountParent instanceof HTMLElement)
                    || !currentUiMountParent.isConnected
                    || ui.host.hidden
                ));
            if (pathChanged || mountBroken) scheduleUiAttachment();
        }, UI_WATCHDOG_INTERVAL_MS);
    }

    function initializeAfterDomReady() {
        mountUi();
        startComposerObserver();
        startThemeObserver();
        attachUiAboveComposer();
        syncComposerButton();
        refreshUsage({ force: true });
        startRefreshLoop();
        startUiPositionLoop();
    }

    window.addEventListener('pointerdown', handlePointerOrClick, true);
    window.addEventListener('click', handlePointerOrClick, true);
    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('submit', handleSubmit, true);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', scheduleResumeRefresh);
    window.addEventListener('resize', scheduleUiAttachment, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleUiAttachment, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleUiAttachment, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleResumeRefresh();
        } else stopRefreshTimer();
    });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚙️ 크래커 가드 설정 열기', () => {
            mountUi();
            setPanelOpen(true);
        });
        GM_registerMenuCommand('↻ 오늘 사용량 새로고침', () => refreshUsage({
            announce: true,
            force: true,
            activeOnly: false,
        }));
        GM_registerMenuCommand('⏯️ 감시 켜기/끄기', () => {
            saveConfig({ ...config, enabled: !config.enabled });
            syncFormFromConfig();
            showToast(`크래커 가드를 ${config.enabled ? '켰어요.' : '껐어요.'}`, 'ok');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAfterDomReady, { once: true });
    } else {
        initializeAfterDomReady();
    }

    console.info(`[${SCRIPT_NAME}] v${VERSION} 준비됨`);
})();
