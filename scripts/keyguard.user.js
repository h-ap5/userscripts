// ==UserScript==
// @name         ⌨️ 크랙 단축키 오작동 방지
// @namespace    crack-hotkey-leak-guard
// @version      1.0.0
// @description  확장 프로그램이 보낸 가짜 키 입력이 크랙 단축키에 '계속 눌린 키'로 남아 타자 중 요약 메모리 창이 열리는 문제를 막고, 모바일에서는 Esc·조합키가 크랙 단축키를 실행하지 않게 합니다.
// @match        https://crack.wrtn.ai/*
// @updateURL    https://raw.githubusercontent.com/h-ap5/userscripts/main/scripts/keyguard.user.js
// @downloadURL  https://raw.githubusercontent.com/h-ap5/userscripts/main/scripts/keyguard.user.js
// @homepageURL  https://github.com/h-ap5/userscripts
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // 크랙의 Esc·조합키 단축키를 막을 범위: 'mobile'(휴대폰·태블릿만), 'always'(PC 포함), 'never'(막지 않음).
    // 어떤 값이든 다른 확장 프로그램이 보낸 가짜 키 입력은 항상 크랙 단축키에서 가린다.
    const BLOCK_NATIVE_SHORTCUT_KEYS = 'mobile';

    const INSTALLED = '__crackKeyGuardInstalled';
    if (window[INSTALLED]) return;
    window[INSTALLED] = true;

    // 크랙 단축키(react-hotkeys-hook)는 document의 keydown/keyup으로 '지금 눌린 키' 목록을 기억한다.
    // keyup 없이 keydown만 보낸 가짜 Esc가 들어오면 Esc는 창이 포커스를 잃을 때까지 눌린 키로 남고,
    // 그 뒤 Shift·Ctrl 같은 조합키 신호가 올 때마다 'Esc + 조합키'로 판정해 Esc 단축키
    // (요약 메모리 열기/닫기, 입력창 포커스 해제)를 다시 실행한다.
    //
    // 키 이벤트 자체는 막지 않는다. 입력창·버튼·React 처리와 크랙 창(Radix)의 Esc 닫기처럼
    // document 캡처 단계에서 받는 처리는 그대로 두고, 그 뒤 document 일반 단계에서 듣는
    // 크랙 단축키에만 이벤트가 닿지 않게 한다.
    const KEY_EVENTS = ['keydown', 'keyup'];
    const MODIFIER_KEYS = new Set([
        'shift', 'control', 'ctrl', 'alt', 'altgraph', 'meta', 'os',
        'super', 'hyper', 'fn', 'fnlock', 'capslock', 'symbol', 'symbollock',
    ]);
    const MODIFIER_CODE = /^(?:(?:shift|control|alt|meta|os)(?:left|right)?|unknown)$/i;

    const hidden = new WeakSet();
    const blockNativeKeys = BLOCK_NATIVE_SHORTCUT_KEYS === 'always'
        || (BLOCK_NATIVE_SHORTCUT_KEYS === 'mobile' && isMobileDevice());

    function isMobileDevice() {
        try {
            if (navigator.userAgentData?.mobile) return true;
        } catch (_) {}
        const ua = navigator.userAgent || '';
        if (/Android|iPhone|iPad|iPod|Mobi/i.test(ua)) return true;
        // iPadOS Safari는 PC용 UA를 쓰므로 터치 지점 수로 구분한다.
        if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
        try {
            return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        } catch (_) {
            return false;
        }
    }

    function isEscape(event) {
        const key = String(event.key || '').toLowerCase();
        return key === 'escape' || key === 'esc' || event.code === 'Escape';
    }

    // 크랙 단축키는 조합키나 정체를 알 수 없는 키 신호가 올 때도 '눌린 채 기억된 키'를 다시 확인한다.
    function isModifierSignal(event) {
        return MODIFIER_KEYS.has(String(event.key || '').toLowerCase())
            || MODIFIER_CODE.test(String(event.code || ''));
    }

    function shouldHide(event) {
        // 확장 프로그램이 만든 가짜 키는 keyup 짝이 없는 경우가 많아 크랙 단축키에 넘기지 않는다.
        if (!event.isTrusted) return true;
        return blockNativeKeys && (isEscape(event) || isModifierSignal(event));
    }

    // document에 직접 보낸 이벤트는 html을 거치지 않으므로 document에서 멈춘다.
    // 지금 붙이는 캡처 리스너는 이미 등록된 캡처 리스너(크랙 창의 Esc 닫기 등) 뒤에 실행되고,
    // 대상 단계에서는 캡처 리스너가 일반 리스너보다 먼저 실행되므로 크랙 단축키만 건너뛰게 된다.
    function stopAtDocument(event) {
        const type = event.type;
        const stop = (current) => {
            if (current !== event) return;
            document.removeEventListener(type, stop, true);
            current.stopImmediatePropagation();
        };
        document.addEventListener(type, stop, true);
        // document까지 가지 못하고 끝난 경우 남은 리스너를 치운다.
        queueMicrotask(() => document.removeEventListener(type, stop, true));
    }

    function onWindowCapture(event) {
        if (hidden.has(event) || !shouldHide(event)) return;
        hidden.add(event);
        if (event.target === document) stopAtDocument(event);
    }

    // 요소에서 올라온 이벤트는 html에서 멈춘다. 입력창과 React 처리는 이미 끝났고
    // document·window의 일반 리스너만 남은 지점이다.
    function onRootBubble(event) {
        if (hidden.has(event)) event.stopPropagation();
    }

    function attachRoot() {
        const root = document.documentElement;
        if (!root) return false;
        for (const type of KEY_EVENTS) root.addEventListener(type, onRootBubble);
        return true;
    }

    for (const type of KEY_EVENTS) window.addEventListener(type, onWindowCapture, true);
    if (!attachRoot()) {
        const observer = new MutationObserver(() => {
            if (attachRoot()) observer.disconnect();
        });
        observer.observe(document, { childList: true });
    }
})();
