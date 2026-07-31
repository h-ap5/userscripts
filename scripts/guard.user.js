// ==UserScript==
// @name         🛑 Crack 일일 크래커 가드
// @namespace    crack-daily-cracker-guard
// @version      1.2.2
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
    const VERSION = '1.2.2';
    const API_HISTORY = 'https://crack-api.wrtn.ai/crack-cash/crackers/history';
    const CONFIG_KEY = 'cdc_guard_config_v1';
    // 첨부된 대시보드가 실제로 사용 중인 API 페이지 크기에 맞춘다.
    const PAGE_SIZE = 20;
    const MAX_HISTORY_PAGES = 50;
    const REFRESH_INTERVAL_MS = 20_000;
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
    let composerObserver = null;
    let themeObserver = null;
    let composerUpdateTimer = null;
    let uiPositionTimer = null;
    let postSendTimers = [];
    let toastTimer = null;
    let currentUiInlineHost = null;

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
        pillDot: null,
        pillText: null,
        panel: null,
        closeButton: null,
        statusEyebrow: null,
        statusValue: null,
        statusMessage: null,
        progress: null,
        targetValue: null,
        marginValue: null,
        stopValue: null,
        updatedValue: null,
        enabledInput: null,
        limitInput: null,
        marginInput: null,
        regenerationInput: null,
        validation: null,
        refreshButton: null,
        saveButton: null,
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
            return `오늘 ${formatNumber(state.used)}개로 허용 범위 상한 ${formatNumber(range.upper)}개를 넘었어요.`;
        }
        return `오늘 ${formatNumber(state.used)}개에서 목표 허용 범위 ${formatNumber(range.lower)}~${formatNumber(range.upper)}개에 도달했어요.`;
    }

    function isBlocked() {
        return Boolean(getBlockReason());
    }

    function formatNumber(value) {
        return Math.max(0, Number(value) || 0).toLocaleString('ko-KR');
    }

    function formatTime(timestamp) {
        if (!timestamp) return '아직 확인 전';
        return new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).format(new Date(timestamp));
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
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date(now));
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
        if (state.loading) return;
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
        }
    }

    function clearPostSendTimers() {
        for (const timer of postSendTimers) window.clearTimeout(timer);
        postSendTimers = [];
    }

    function schedulePostSendRefreshes() {
        clearPostSendTimers();
        for (const delay of [4_000, 10_000, 22_000]) {
            postSendTimers.push(window.setTimeout(() => refreshUsage(), delay));
        }
    }

    function isChatEditor(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest([
            '[data-sgb-input-box] .__chat_input_textarea',
            '[data-sgb-input-box] [contenteditable="true"]',
            'textarea[placeholder*="메시지"]',
            '[contenteditable="true"][data-placeholder*="메시지"]',
        ].join(',')));
    }

    function getVisibleComposer() {
        const composers = Array.from(document.querySelectorAll('[data-sgb-input-box]'));
        const visible = composers.filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        });
        return visible[visible.length - 1] || composers[composers.length - 1] || null;
    }

    function findSendButton(composer = getVisibleComposer()) {
        if (!composer) return null;

        const explicitSelectors = [
            'button[data-cdcg-send-button="1"]',
            'button[data-crack-ui-empty-send-guard]',
            'button[type="submit"]',
            'button[aria-label*="메시지 보내"]',
            'button[aria-label*="전송"]',
            'button[title*="메시지 보내"]',
            'button[title*="전송"]',
        ];
        for (const selector of explicitSelectors) {
            const match = composer.querySelector(selector);
            if (match) return match;
        }

        const candidates = Array.from(composer.querySelectorAll('button')).filter((button) => {
            const className = String(button.className || '');
            return button.querySelector('svg')
                && className.includes('bg-primary')
                && className.includes('text-primary-foreground');
        });
        return candidates[candidates.length - 1] || null;
    }

    function isSendButtonTarget(target) {
        if (!(target instanceof Element)) return false;
        const button = target.closest('button');
        if (!button) return false;
        const composer = button.closest('[data-sgb-input-box]');
        if (!composer) return false;
        return button === findSendButton(composer);
    }

    function isRegenerationTarget(target) {
        if (!config.blockRegeneration || !(target instanceof Element)) return false;
        const button = target.closest('button, [role="button"]');
        if (!button || button.closest('#cdcg-root')) return false;
        const label = [
            button.getAttribute('aria-label'),
            button.getAttribute('title'),
            button.textContent,
        ].filter(Boolean).join(' ').trim();
        return /다시\s*생성|재생성|리롤|reroll|regenerate/i.test(label);
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
        const regenerationAttempt = isRegenerationTarget(event.target);
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
        const composer = event.target instanceof Element
            ? event.target.closest('form')?.querySelector('[data-sgb-input-box]')
            : null;
        if (!composer) return;
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
            [data-cdcg-guard-space="1"] {
                padding-top: calc(var(--cdcg-base-padding-top, 0px) + 20px) !important;
            }

            #cdcg-root {
                position: fixed !important;
                inset: 0 !important;
                pointer-events: none !important;
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

    function mountUi() {
        if (ui.host?.isConnected || !document.body) return;
        injectOuterStyle();

        const host = document.createElement('div');
        host.id = 'cdcg-root';
        host.dataset.theme = getPageTheme();
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    --cdcg-primary: #ff6301;
                    --cdcg-primary-hover: #e85b00;
                    --cdcg-surface: rgba(24, 24, 27, .98);
                    --cdcg-surface-soft: rgba(39, 39, 42, .98);
                    --cdcg-row-hover: rgba(255, 255, 255, .07);
                    --cdcg-border: rgba(255, 255, 255, .14);
                    --cdcg-text: rgba(255, 255, 255, .90);
                    --cdcg-muted: rgba(255, 255, 255, .62);
                    --cdcg-faint: rgba(255, 255, 255, .44);
                    --cdcg-inline-text: var(--sgb-readable-text, rgba(255, 255, 255, .88));
                    --cdcg-inline-muted: var(--sgb-muted-text, rgba(255, 255, 255, .58));
                    --cdcg-accent-safe: #3ddc84;
                    --cdcg-accent-warn: #ffd54a;
                    --cdcg-accent-danger: #ff5c5c;
                    --cdcg-font-xs: 10px;
                    --cdcg-font-sm: 11px;
                    --cdcg-font-md: 12px;
                    --cdcg-font-title: 13px;
                    all: initial;
                    color: var(--cdcg-text);
                    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
                }

                :host([data-theme="light"]) {
                    --cdcg-surface: rgba(250, 250, 250, .98);
                    --cdcg-surface-soft: rgba(238, 238, 240, .98);
                    --cdcg-row-hover: rgba(0, 0, 0, .06);
                    --cdcg-border: rgba(0, 0, 0, .14);
                    --cdcg-text: rgba(0, 0, 0, .85);
                    --cdcg-muted: rgba(0, 0, 0, .62);
                    --cdcg-faint: rgba(0, 0, 0, .44);
                    --cdcg-inline-text: var(--sgb-readable-text, rgba(0, 0, 0, .82));
                    --cdcg-inline-muted: var(--sgb-muted-text, rgba(0, 0, 0, .58));
                    --cdcg-accent-safe: #1da851;
                    --cdcg-accent-warn: #d49500;
                    --cdcg-accent-danger: #e03535;
                }

                *, *::before, *::after { box-sizing: border-box; }
                button, input { font: inherit; }
                button { -webkit-tap-highlight-color: transparent; }

                .dock {
                    position: fixed;
                    bottom: var(--cdcg-anchor-bottom, 16px);
                    left: var(--cdcg-anchor-x, 50%);
                    width: var(--cdcg-anchor-width, min(768px, calc(100vw - 32px)));
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    transform: translateX(-50%);
                    pointer-events: none;
                }

                .pill,
                .panel,
                .toast { pointer-events: auto; }

                .toast { order: 1; }
                .panel { order: 2; }
                .pill { order: 3; }

                .pill {
                    width: 100%;
                    height: 20px;
                    min-height: 20px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 0 6px;
                    border: 1px solid var(--cdcg-inline-border, var(--cdcg-border));
                    border-radius: var(--cdcg-inline-radius, 6px);
                    background-color: var(--cdcg-inline-bg-color, rgba(24, 24, 27, .72));
                    background-image: var(--cdcg-inline-bg-image, none);
                    backdrop-filter: var(--cdcg-inline-backdrop, none);
                    -webkit-backdrop-filter: var(--cdcg-inline-backdrop, none);
                    color: var(--cdcg-text);
                    box-shadow: none;
                    cursor: pointer;
                    transition: background 140ms ease;
                }

                .pill:hover { filter: brightness(1.08); }
                .pill:active { opacity: .72; }
                .pill:focus-visible { outline: 2px solid var(--cdcg-primary); outline-offset: 1px; }

                .dot {
                    width: 6px;
                    height: 6px;
                    flex: 0 0 6px;
                    border-radius: 50%;
                    background: var(--cdcg-accent-safe);
                }

                .pill[data-status="blocked"] .dot {
                    background: var(--cdcg-accent-danger);
                    box-shadow: 0 0 6px rgba(255, 92, 92, .9);
                    animation: cdcg-blocked-pulse 1.25s ease-in-out infinite;
                }

                .pill[data-status="loading"] .dot,
                .pill[data-status="warning"] .dot {
                    background: var(--cdcg-accent-warn);
                }

                .pill-copy {
                    width: 100%;
                    min-width: 0;
                    display: flex;
                    flex-direction: row;
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

                .pill-label {
                    overflow: hidden;
                    color: var(--cdcg-inline-text);
                    font-size: var(--cdcg-font-sm);
                    font-weight: 650;
                    line-height: 1;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .pill-summary {
                    overflow: hidden;
                    color: var(--cdcg-inline-muted);
                    font-size: var(--cdcg-font-xs);
                    font-weight: 560;
                    line-height: 1;
                    font-variant-numeric: tabular-nums;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .pill[data-status="blocked"] .pill-summary { color: var(--cdcg-accent-danger); }
                .pill[data-status="warning"] .pill-summary { color: var(--cdcg-accent-warn); }

                @keyframes cdcg-blocked-pulse {
                    0%, 100% { opacity: .62; box-shadow: 0 0 2px rgba(255, 92, 92, .45); }
                    50% { opacity: 1; box-shadow: 0 0 7px rgba(255, 92, 92, .95); }
                }

                .panel {
                    width: min(292px, calc(100vw - 16px));
                    max-height: min(440px, 65vh);
                    align-self: flex-end;
                    margin-right: 4px;
                    overflow: auto;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 12px;
                    background: var(--cdcg-surface);
                    box-shadow: 0 12px 34px rgba(0, 0, 0, .34);
                }

                .panel[hidden] { display: none; }

                .panel-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 10px 10px 8px;
                    border-bottom: 1px solid var(--cdcg-border);
                }

                .panel-header h2 {
                    margin: 0;
                    color: var(--cdcg-text);
                    font-size: var(--cdcg-font-title);
                    font-weight: 750;
                    line-height: 1.25;
                }

                .panel-header p {
                    margin: 2px 0 0;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.4;
                }

                .icon-button {
                    width: 24px;
                    height: 24px;
                    flex: 0 0 24px;
                    display: grid;
                    place-items: center;
                    border: 1px solid transparent;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-md);
                    cursor: pointer;
                    transition: background 160ms ease, color 160ms ease;
                }

                .icon-button:hover { background: var(--cdcg-surface-soft); color: var(--cdcg-text); }
                .icon-button:active { opacity: .72; }
                .icon-button:focus-visible { outline: 2px solid var(--cdcg-primary); }

                .status-card {
                    margin: 8px 10px 0;
                    padding: 8px;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 8px;
                    background: var(--cdcg-surface-soft);
                }

                .eyebrow {
                    margin: 0;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    font-weight: 650;
                    line-height: 1.25;
                }

                .status-value {
                    margin: 3px 0 0;
                    color: var(--cdcg-text);
                    font-size: 16px;
                    font-weight: 750;
                    line-height: 1.25;
                    font-variant-numeric: tabular-nums;
                }

                .status-value span {
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-sm);
                    font-weight: 560;
                }

                .track {
                    height: 3px;
                    margin-top: 6px;
                    overflow: hidden;
                    border-radius: 999px;
                    background: var(--cdcg-border);
                }

                .progress {
                    width: 0;
                    height: 100%;
                    border-radius: inherit;
                    background: var(--cdcg-primary);
                    transition: width 240ms ease, background 160ms ease;
                }

                .status-message {
                    margin: 5px 0 0;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.4;
                }

                .metrics {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 4px;
                    margin-top: 7px;
                }

                .metric {
                    min-width: 0;
                    padding: 4px;
                    border-radius: 5px;
                    background: var(--cdcg-row-hover);
                }

                .metric span {
                    display: block;
                    overflow: hidden;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.15;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .metric strong {
                    display: block;
                    margin-top: 2px;
                    color: var(--cdcg-text);
                    font-size: var(--cdcg-font-sm);
                    line-height: 1.15;
                    font-variant-numeric: tabular-nums;
                }

                .form {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    padding: 10px;
                }

                .switch-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }

                .switch-copy strong,
                .field label {
                    display: block;
                    color: var(--cdcg-text);
                    font-size: var(--cdcg-font-sm);
                    font-weight: 650;
                    line-height: 1.25;
                }

                .switch-copy span,
                .field small {
                    display: block;
                    margin-top: 2px;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.35;
                }

                .switch {
                    position: relative;
                    width: 34px;
                    height: 20px;
                    flex: 0 0 34px;
                }

                .switch input {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                }

                .switch span {
                    position: absolute;
                    inset: 0;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 999px;
                    background: var(--cdcg-surface-soft);
                    cursor: pointer;
                    transition: background 160ms ease, border-color 160ms ease;
                }

                .switch span::after {
                    content: "";
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: var(--cdcg-muted);
                    transition: transform 160ms ease, background 160ms ease;
                }

                .switch input:checked + span {
                    border-color: var(--cdcg-primary);
                    background: var(--cdcg-primary);
                }

                .switch input:checked + span::after {
                    transform: translateX(14px);
                    background: #fff;
                }

                .switch input:focus-visible + span {
                    outline: 2px solid var(--cdcg-primary);
                }

                .field-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }

                .field input {
                    width: 100%;
                    height: 30px;
                    margin-top: 4px;
                    padding: 0 8px;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 6px;
                    outline: none;
                    background: var(--cdcg-surface-soft);
                    color: var(--cdcg-text);
                    font-size: var(--cdcg-font-md);
                    font-variant-numeric: tabular-nums;
                    transition: border-color 160ms ease, box-shadow 160ms ease;
                }

                .field input:focus {
                    border-color: var(--cdcg-primary);
                    box-shadow: 0 0 0 2px rgba(255, 99, 1, .16);
                }

                .validation {
                    min-height: 0;
                    margin: 0;
                    color: var(--cdcg-accent-danger);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.4;
                }

                .validation:empty { display: none; }

                .actions {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }

                .button {
                    min-height: 30px;
                    padding: 5px 8px;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 6px;
                    background: var(--cdcg-surface-soft);
                    color: var(--cdcg-text);
                    font-size: var(--cdcg-font-sm);
                    font-weight: 650;
                    cursor: pointer;
                    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
                }

                .button:hover { border-color: var(--cdcg-muted); }
                .button:active { transform: translateY(1px); }
                .button:focus-visible { outline: 2px solid var(--cdcg-primary); }
                .button:disabled { cursor: wait; opacity: .52; }

                .button.primary {
                    border-color: var(--cdcg-primary);
                    background: var(--cdcg-primary);
                    color: #fff;
                }

                .button.primary:hover { background: var(--cdcg-primary-hover); }

                .footnote {
                    margin: 0;
                    color: var(--cdcg-muted);
                    font-size: var(--cdcg-font-xs);
                    line-height: 1.4;
                }

                .toast {
                    display: none;
                    width: min(292px, calc(100vw - 16px));
                    align-self: flex-end;
                    margin-right: 4px;
                    padding: 7px 9px;
                    border: 1px solid var(--cdcg-border);
                    border-radius: 8px;
                    background: var(--cdcg-surface);
                    color: var(--cdcg-text);
                    box-shadow: 0 8px 20px rgba(0, 0, 0, .24);
                    font-size: var(--cdcg-font-sm);
                    line-height: 1.4;
                }

                .toast[data-visible="true"] { display: block; }
                .toast[data-kind="blocked"],
                .toast[data-kind="error"] { border-color: var(--cdcg-accent-danger); }
                .toast[data-kind="ok"] { border-color: var(--cdcg-accent-safe); }

                @media (max-width: 520px) {
                    .panel {
                        width: min(280px, calc(100vw - 16px));
                        max-height: 60vh;
                    }
                    .pill-label { font-size: var(--cdcg-font-xs); }
                }

                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after {
                        scroll-behavior: auto !important;
                        transition: none !important;
                    }
                }
            </style>
            <div class="dock">
                <div class="toast" role="status" aria-live="polite"></div>
                <section class="panel" aria-labelledby="cdcg-title" hidden>
                    <header class="panel-header">
                        <div>
                            <h2 id="cdcg-title">일일 크래커 가드</h2>
                            <p>사용 내역 기준 자동 차단</p>
                        </div>
                        <button class="icon-button" type="button" aria-label="설정 닫기">✕</button>
                    </header>

                    <div class="status-card">
                        <p class="eyebrow">오늘 사용량</p>
                        <p class="status-value">0 <span>/ 목표 1,000 · 범위 800~1,200</span></p>
                        <div class="track" aria-hidden="true"><div class="progress"></div></div>
                        <p class="status-message">사용 내역을 확인하고 있어요.</p>
                        <div class="metrics">
                            <div class="metric"><span>일일 목표</span><strong data-metric="target">1,000개</strong></div>
                            <div class="metric"><span>허용 오차</span><strong data-metric="margin">±200개</strong></div>
                            <div class="metric"><span>정지 구간</span><strong data-metric="stop">800~1,200개</strong></div>
                        </div>
                    </div>

                    <div class="form">
                        <div class="switch-row">
                            <div class="switch-copy">
                                <strong>감시 사용</strong>
                                <span>끄면 사용량은 표시하되 전송은 막지 않아요.</span>
                            </div>
                            <label class="switch">
                                <input type="checkbox" data-field="enabled">
                                <span aria-hidden="true"></span>
                            </label>
                        </div>

                        <div class="field-grid">
                            <div class="field">
                                <label for="cdcg-limit">일일 목표</label>
                                <input id="cdcg-limit" type="number" min="1" max="10000000" step="1" inputmode="numeric">
                                <small>하루 사용량의 중심 기준</small>
                            </div>
                            <div class="field">
                                <label for="cdcg-margin">허용 오차 (±)</label>
                                <input id="cdcg-margin" type="number" min="0" max="9999999" step="1" inputmode="numeric">
                                <small>목표의 위·아래 범위</small>
                            </div>
                        </div>

                        <div class="switch-row">
                            <div class="switch-copy">
                                <strong>재생성도 차단</strong>
                                <span>리롤·다시 생성으로 추가 소모되는 것도 막아요.</span>
                            </div>
                            <label class="switch">
                                <input type="checkbox" data-field="regeneration">
                                <span aria-hidden="true"></span>
                            </label>
                        </div>

                        <p class="validation" role="alert"></p>

                        <div class="actions">
                            <button class="button" type="button" data-action="refresh">지금 새로고침</button>
                            <button class="button primary" type="button" data-action="save">설정 저장</button>
                        </div>

                        <p class="footnote">
                            사용량은 크랙의 크래커 사용 내역을 한국 시간의 오늘 0시부터 합산합니다.
                            마지막 확인: <span data-updated>아직 확인 전</span>
                        </p>
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
        ui.pillDot = shadow.querySelector('.dot');
        ui.pillText = shadow.querySelector('.pill-summary');
        ui.panel = shadow.querySelector('.panel');
        ui.closeButton = shadow.querySelector('.icon-button');
        ui.statusEyebrow = shadow.querySelector('.eyebrow');
        ui.statusValue = shadow.querySelector('.status-value');
        ui.statusMessage = shadow.querySelector('.status-message');
        ui.progress = shadow.querySelector('.progress');
        ui.targetValue = shadow.querySelector('[data-metric="target"]');
        ui.marginValue = shadow.querySelector('[data-metric="margin"]');
        ui.stopValue = shadow.querySelector('[data-metric="stop"]');
        ui.updatedValue = shadow.querySelector('[data-updated]');
        ui.enabledInput = shadow.querySelector('[data-field="enabled"]');
        ui.limitInput = shadow.querySelector('#cdcg-limit');
        ui.marginInput = shadow.querySelector('#cdcg-margin');
        ui.regenerationInput = shadow.querySelector('[data-field="regeneration"]');
        ui.validation = shadow.querySelector('.validation');
        ui.refreshButton = shadow.querySelector('[data-action="refresh"]');
        ui.saveButton = shadow.querySelector('[data-action="save"]');
        ui.toast = shadow.querySelector('.toast');

        ui.pill.addEventListener('click', () => setPanelOpen(!state.panelOpen));
        ui.closeButton.addEventListener('click', () => setPanelOpen(false));
        ui.refreshButton.addEventListener('click', () => refreshUsage({ announce: true }));
        ui.saveButton.addEventListener('click', handleSave);
        ui.limitInput.addEventListener('input', validateForm);
        ui.marginInput.addEventListener('input', validateForm);

        syncFormFromConfig();
        render();
    }

    function getPageTheme() {
        const root = document.documentElement;
        const explicit = String(
            root.dataset.sgbTheme
            || root.dataset.crackTheme
            || root.dataset.theme
            || '',
        ).toLowerCase();
        if (explicit === 'light') return 'light';
        if (explicit === 'dark') return 'dark';
        return root.classList.contains('dark') ? 'dark' : 'light';
    }

    function syncTheme() {
        if (ui.host) ui.host.dataset.theme = getPageTheme();
    }

    function startThemeObserver() {
        if (themeObserver) return;
        themeObserver = new MutationObserver(() => {
            syncTheme();
            attachUiAboveComposer();
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
    }

    function findUiInlineHost() {
        const composer = getVisibleComposer();
        if (!(composer instanceof HTMLElement)) return null;

        const preferred = composer.closest('[data-sgb-input-host]');
        if (preferred instanceof HTMLElement) return preferred;

        const candidates = [
            composer.parentElement,
            composer.closest('form'),
            composer.parentElement?.parentElement,
        ];
        const viewportWidth = window.innerWidth || 1;
        const composerRect = composer.getBoundingClientRect();
        const maxReasonableWidth = Math.min(
            viewportWidth * 0.98,
            Math.max(composerRect.width * 1.55, composerRect.width + 220),
        );

        for (const candidate of candidates) {
            if (!(candidate instanceof HTMLElement)) continue;
            if (candidate === document.body || candidate === document.documentElement) continue;
            const rect = candidate.getBoundingClientRect();
            if (rect.width < 180 || rect.height < 28) continue;
            if (rect.width > maxReasonableWidth) continue;
            return candidate;
        }

        return null;
    }

    function detachUiInlineHost() {
        if (currentUiInlineHost instanceof HTMLElement) {
            currentUiInlineHost.removeAttribute('data-cdcg-guard-space');
            currentUiInlineHost.style.removeProperty('--cdcg-base-padding-top');
        }
        currentUiInlineHost = null;
    }

    function syncGuardReservedSpace(host, shouldReserve) {
        if (!(host instanceof HTMLElement)) return;
        if (!shouldReserve) {
            host.removeAttribute('data-cdcg-guard-space');
            host.style.removeProperty('--cdcg-base-padding-top');
            return;
        }
        if (host.hasAttribute('data-cdcg-guard-space')) return;
        const basePaddingTop = Number.parseFloat(window.getComputedStyle(host).paddingTop) || 0;
        host.style.setProperty('--cdcg-base-padding-top', `${basePaddingTop}px`);
        host.setAttribute('data-cdcg-guard-space', '1');
    }

    function syncInlineThemeFromComposer(host) {
        if (!(host instanceof HTMLElement) || !ui.host) return;
        const source = host.querySelector('[data-sgb-input-box]') || getVisibleComposer();
        if (!(source instanceof HTMLElement)) return;
        const style = window.getComputedStyle(source);
        const backgroundColor = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? style.backgroundColor
            : (getPageTheme() === 'dark' ? 'rgba(24, 24, 27, .76)' : 'rgba(250, 250, 250, .82)');
        ui.host.style.setProperty('--cdcg-inline-bg-color', backgroundColor);
        ui.host.style.setProperty('--cdcg-inline-bg-image', style.backgroundImage || 'none');
        ui.host.style.setProperty('--cdcg-inline-border', style.borderTopColor || style.borderColor || 'transparent');
        ui.host.style.setProperty('--cdcg-inline-radius', style.borderRadius || '6px');
        ui.host.style.setProperty(
            '--cdcg-inline-backdrop',
            style.backdropFilter || style.webkitBackdropFilter || 'none',
        );
    }

    function attachUiAboveComposer() {
        if (!ui.host) return false;
        const nextHost = findUiInlineHost();

        if (!nextHost) {
            detachUiInlineHost();
            state.panelOpen = false;
            if (ui.panel) ui.panel.hidden = true;
            if (ui.pill) ui.pill.setAttribute('aria-expanded', 'false');
            ui.host.hidden = true;
            return false;
        }

        if (currentUiInlineHost && currentUiInlineHost !== nextHost) detachUiInlineHost();
        currentUiInlineHost = nextHost;
        if (document.body && ui.host.parentNode !== document.body) {
            document.body.appendChild(ui.host);
        }

        const hasRadiosondeRow = Boolean(
            nextHost.querySelector('#igx-live-popup')
            || document.getElementById('igx-live-popup'),
        );
        syncGuardReservedSpace(nextHost, hasRadiosondeRow);
        syncInlineThemeFromComposer(nextHost);

        const rect = nextHost.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const rowTopOffset = hasRadiosondeRow ? 28 : 6;
        const pillBottom = rect.top + rowTopOffset + 20;
        const anchorX = Math.max(24, Math.min(window.innerWidth - 24, rect.left + rect.width / 2));
        const anchorBottom = Math.max(8, viewportHeight - pillBottom);
        ui.host.style.setProperty('--cdcg-anchor-x', `${anchorX}px`);
        ui.host.style.setProperty('--cdcg-anchor-bottom', `${anchorBottom}px`);
        ui.host.style.setProperty('--cdcg-anchor-width', `${rect.width}px`);
        ui.host.hidden = false;
        return true;
    }

    function setPanelOpen(open) {
        state.panelOpen = Boolean(open);
        if (!ui.panel || !ui.pill) return;
        ui.panel.hidden = !state.panelOpen;
        ui.pill.setAttribute('aria-expanded', String(state.panelOpen));
        if (state.panelOpen) {
            syncFormFromConfig();
            render();
        }
    }

    function syncFormFromConfig() {
        if (!ui.enabledInput) return;
        ui.enabledInput.checked = config.enabled;
        ui.limitInput.value = String(config.dailyLimit);
        ui.marginInput.value = String(config.safetyMargin);
        ui.regenerationInput.checked = config.blockRegeneration;
        ui.validation.textContent = '';
        ui.saveButton.disabled = false;
    }

    function validateForm() {
        if (!ui.limitInput) return false;
        const dailyLimit = Number.parseInt(ui.limitInput.value, 10);
        const safetyMargin = Number.parseInt(ui.marginInput.value, 10);
        let message = '';

        if (!Number.isFinite(dailyLimit) || dailyLimit < 1) {
            message = '일일 목표는 1개 이상으로 입력해 주세요.';
        } else if (!Number.isFinite(safetyMargin) || safetyMargin < 0) {
            message = '허용 오차는 0개 이상으로 입력해 주세요.';
        } else if (safetyMargin >= dailyLimit) {
            message = '허용 오차는 일일 목표보다 작아야 해요.';
        }

        ui.validation.textContent = message;
        ui.saveButton.disabled = Boolean(message);
        return !message;
    }

    function handleSave() {
        if (!validateForm()) return;
        const dailyLimit = clampInteger(ui.limitInput.value, 1, 10_000_000, config.dailyLimit);
        const safetyMargin = clampInteger(ui.marginInput.value, 0, dailyLimit - 1, config.safetyMargin);
        saveConfig({
            enabled: ui.enabledInput.checked,
            dailyLimit,
            safetyMargin,
            blockRegeneration: ui.regenerationInput.checked,
        });
        const range = getTargetRange({ dailyLimit, safetyMargin });
        showToast(
            `설정했어요. ${formatNumber(range.lower)}~${formatNumber(range.upper)}개 안에서 목표에 가깝게 멈춥니다.`,
            'ok',
        );
    }

    function render() {
        if (!ui.host?.isConnected) return;
        const decision = getBudgetDecision();
        const { range } = decision;
        const blockReason = getBlockReason();
        const blocked = Boolean(blockReason);
        const ratio = range.target > 0
            ? Math.min(100, Math.max(0, (state.used / range.target) * 100))
            : 100;
        const remainingToRange = Math.max(0, range.lower - state.used);
        const targetText = formatNumber(range.target);
        const rangeText = `${formatNumber(range.lower)}~${formatNumber(range.upper)}`;

        let status = 'safe';
        let pillSummary = `오늘 ${formatNumber(state.used)} / ${targetText}`;
        let eyebrow = '오늘 사용량';
        let message = remainingToRange > 0
            ? `${formatNumber(remainingToRange)}개 후 목표 허용 범위에 들어가요.`
            : `목표 허용 범위 ${rangeText}개를 확인하고 있어요.`;

        if (decision.phase === 'approaching-target' && decision.predicted) {
            message = `최근 ${formatNumber(decision.estimate)}개 기준, 다음 예상 ${formatNumber(decision.predicted)}개가 목표에 더 가까워 한 번 더 허용해요.`;
        }

        if (!config.enabled) {
            status = 'warning';
            pillSummary = `감시 꺼짐, 오늘 ${formatNumber(state.used)} / ${targetText}`;
            eyebrow = '감시 꺼짐';
            message = '현재는 사용량과 관계없이 전송할 수 있어요.';
        } else if (blocked) {
            status = 'blocked';
            pillSummary = state.loading && !state.lastUpdatedAt
                ? '사용량 확인 중, 전송 대기'
                : `차단됨, 오늘 ${formatNumber(state.used)} / ${targetText}`;
            eyebrow = '전송 차단 중';
            message = blockReason;
        } else if (state.loading) {
            status = 'loading';
            pillSummary = `갱신 중, 오늘 ${formatNumber(state.used)} / ${targetText}`;
            message = '최신 사용 내역을 확인하고 있어요.';
        } else if (state.error) {
            status = 'warning';
            pillSummary = `확인 필요, 오늘 ${formatNumber(state.used)} / ${targetText}`;
            message = state.error;
        }

        ui.pill.dataset.status = status;
        ui.pillText.textContent = pillSummary;
        ui.statusEyebrow.textContent = eyebrow;
        ui.statusValue.innerHTML = `${formatNumber(state.used)} <span>/ 목표 ${targetText} · 범위 ${rangeText}</span>`;
        ui.statusMessage.textContent = message;
        ui.progress.style.width = `${ratio}%`;
        ui.progress.style.background = blocked
            ? 'var(--cdcg-accent-danger)'
            : ratio >= 75
                ? 'var(--cdcg-accent-warn)'
                : 'var(--cdcg-primary)';
        ui.targetValue.textContent = `${targetText}개`;
        ui.marginValue.textContent = `±${formatNumber(range.tolerance)}개`;
        ui.stopValue.textContent = `${rangeText}개`;
        ui.updatedValue.textContent = state.error
            ? `${formatTime(state.lastUpdatedAt)} · ${state.error}`
            : `${formatTime(state.lastUpdatedAt)} · ${state.recordCount}건`;
        ui.refreshButton.disabled = state.loading;
        ui.refreshButton.textContent = state.loading ? '확인 중…' : '지금 새로고침';
    }

    function showToast(message, kind = 'info') {
        if (!ui.toast) return;
        window.clearTimeout(toastTimer);
        ui.toast.textContent = message;
        ui.toast.dataset.kind = kind;
        ui.toast.dataset.visible = 'true';
        toastTimer = window.setTimeout(() => {
            if (ui.toast) ui.toast.dataset.visible = 'false';
        }, kind === 'blocked' ? 5_000 : 3_500);
    }

    function startComposerObserver() {
        if (composerObserver || !document.body) return;
        composerObserver = new MutationObserver(() => {
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

    function startRefreshLoop() {
        window.clearInterval(refreshTimer);
        refreshTimer = window.setInterval(() => refreshUsage(), REFRESH_INTERVAL_MS);
    }

    function startUiPositionLoop() {
        window.clearInterval(uiPositionTimer);
        uiPositionTimer = window.setInterval(() => {
            if (document.visibilityState !== 'hidden') attachUiAboveComposer();
        }, 900);
    }

    function initializeAfterDomReady() {
        mountUi();
        startComposerObserver();
        startThemeObserver();
        attachUiAboveComposer();
        syncComposerButton();
        refreshUsage();
        startRefreshLoop();
        startUiPositionLoop();
    }

    window.addEventListener('pointerdown', handlePointerOrClick, true);
    window.addEventListener('click', handlePointerOrClick, true);
    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('submit', handleSubmit, true);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', () => refreshUsage());
    window.addEventListener('resize', attachUiAboveComposer, { passive: true });
    window.visualViewport?.addEventListener('resize', attachUiAboveComposer, { passive: true });
    window.visualViewport?.addEventListener('scroll', attachUiAboveComposer, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            attachUiAboveComposer();
            refreshUsage();
        }
    });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚙️ 크래커 가드 설정 열기', () => {
            mountUi();
            setPanelOpen(true);
        });
        GM_registerMenuCommand('↻ 오늘 사용량 새로고침', () => refreshUsage({ announce: true }));
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
