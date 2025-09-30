// ==UserScript==
// @name         Twitch Chat grok
// @namespace    http://tampermonkey.net/
// @version      1.26
// @description  Display images, embed MP4 videos, YouTube videos, and add movable custom emoji panel with tabbed UI in Twitch chat body
// @author       You
// @match        https://www.twitch.tv/*
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    'use strict';

    const $ = window.jQuery;

    // 動態表情集映射，包含 image 屬性
    let emojiLists = {};
    let altToEmojiMap = {};

    // 正則表達式
    const twitterImageRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^?]+\?format=(jpg|jpeg|png|gif|webp)/i;
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i;
    const mp4Regex = /\.mp4(?:[/?].*)?$/i;

    // 聊天輸入框選擇器
    const CHAT_INPUT_SELECTOR = 'textarea[data-a-target="chat-input"], div[data-a-target="chat-input"]';
    const TEXTBOX_SELECTOR = 'div[role="textbox"]';

    // 快取 DOM 元素
    let cachedTextbox = null;

    // 節流函數
    function throttle(fn, wait) {
        let lastCall = 0;
        return function (...args) {
            const now = Date.now();
            if (now - lastCall >= wait) {
                lastCall = now;
                return fn(...args);
            }
        };
    }

    // 從 URL 中提取參數
    function getParameterByName(name, url) {
        if (!url) url = window.location.href;
        name = name.replace(/[\[\]]/g, "\\$&");
        var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
            results = regex.exec(url);
        if (!results) return null;
        if (!results[2]) return '';
        return decodeURIComponent(results[2].replace(/\+/g, " "));
    }

    // 獲取當前頻道 ID
    function chatchecker() {
        var str1 = window.location.pathname;
        var str2 = "/popout/";
        var str3 = "/embed/";
        var str4 = "/moderator/";
        var str5 = "/stream-manager";
        var currenthost = window.location.hostname;
        var IdContent;

        if (str1.indexOf(str2) != -1 || str1.indexOf(str3) != -1) {
            IdContent = str1.replace("/popout/", '').replace("/embed/", '').replace("/chat", '');
        } else if (str1.indexOf(str4) != -1) {
            IdContent = str1.replace('/moderator/', '');
        } else if ($("a[data-a-target='watch-mode-to-home']").length == "1") {
            IdContent = $("a[data-a-target='watch-mode-to-home']").attr('href').replace('/', '');
        } else if ($('#live-channel-stream-information .tw-image-avatar').length == "1") {
            IdContent = $("#live-channel-stream-information .tw-image-avatar").parent("div").parent("div").parent("a").attr('href').replace('/', '');
        } else if ($('#live-channel-stream-information-upper .tw-image-avatar').length == "1") {
            IdContent = $("#live-channel-stream-information-upper .tw-image-avatar").parent("div").parent("div").parent("a").attr('href').replace('/', '');
        } else if (str1.indexOf(str5) != -1) {
            var idset = str1.split("/");
            IdContent = idset[2];
        } else if (currenthost == 'embed.twitch.tv') {
            const params = new URLSearchParams(window.location.search);
            IdContent = params.get("channel");
        } else if ($('#chat-room-header-label').length == "1"){
            var currenthref = window.location.href;
            IdContent = currenthref.replace("https://www.twitch.tv/", "").split("/")[0];
        }
        return IdContent;
    }

    // 加載表情集
    function loadEmojiSets(callback) {
        const IdContent = chatchecker();

        // 加載公共表情集
        $.getJSON("https://chicktv.github.io/tv/showset.txt", function(setarray) {
            setarray.set.forEach(list => {
                emojiLists[list.name] = {
                    emojis: [],
                    image: list.image || '' // 默認佔位圖
                };
                $.getJSON(`https://chicktv.github.io/tv/${list.name}.txt`, function(iconarray) {
                    iconarray[list.name].forEach(icon => {
                        if (icon.id) {
                            emojiLists[list.name].emojis.push({
                                alt: icon.alt,
                                src: icon.src,
                                dis: icon.dis || icon.alt
                            });
                            if (icon.alt && icon.src) {
                                altToEmojiMap[icon.alt] = {
                                    src: icon.src,
                                    width: '32',
                                    height: '32'
                                };
                            }
                        }
                    });
                });
            });

            // 加載頻道自訂表情
            $.getJSON("https://chicktv.github.io/tv/skuser_icon.txt", function(icon) {
                emojiLists["本台"] = {
                    emojis: [],
                    image: 'https://scontent.fhkg1-2.fna.fbcdn.net/v/t39.30808-6/241575574_4409436685809886_4050045505114174870_n.jpg?_nc_cat=108&ccb=1-7&_nc_sid=6ee11a&_nc_ohc=f5tSvHfwOXsQ7kNvgFSF_xD&_nc_oc=AdlWIJhRHhHgaJt70Ggul_Q4tFMrgvFSI37vsr9t13hHAPvmk7zzU7P5Y2asI5Cvr1I&_nc_zt=23&_nc_ht=scontent.fhkg1-2.fna&_nc_gid=3Z8F9HfcM8befGxG_0MtmA&oh=00_AYGO8-sHSvCiuEbGmDGH7UUjJgdfX4IcNc-khdnLqc3jLw&oe=67E584DC' // 自訂標籤默認圖片
                };
                if (icon && icon.length > 0) {
                    icon.forEach(item => {
                        emojiLists["本台"].emojis.push({
                            alt: item.alt,
                            src: item.src,
                            dis: item.alt
                        });
                        altToEmojiMap[item.alt] = {
                            src: item.src,
                            width: '32',
                            height: '32'
                        };
                    });
                }

                // BTTV 自訂表情
                emojiLists["BTTV"] = {
                    emojis: getSavedBTTVEmojis().map(url => ({
                        alt: url.split('/').pop(),
                        src: url,
                        dis: url
                    })),
                    image: 'https://via.placeholder.com/32?text=BTTV' // BTTV 標籤默認圖片
                };

                callback();
            });
        });
    }

    // 處理單個訊息
    function processMessage(message) {
        const link = message.querySelector('a');
        if (link && !link.classList.contains('processed')) {
            const url = link.href;
            const parent = link.parentNode;
            const fullText = parent.textContent;
            const linkText = link.textContent;
            const beforeText = fullText.substring(0, fullText.indexOf(linkText));
            const afterText = fullText.substring(fullText.indexOf(linkText) + linkText.length);

            if (youtubeRegex.test(url)) {
                const match = url.match(youtubeRegex);
                const videoId = match[1];
                const iframe = document.createElement('iframe');
                iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0`;
                iframe.width = '300';
                iframe.height = '169';
                iframe.frameBorder = '0';
                iframe.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture';
                iframe.allowFullscreen = true;
                replaceLinkWithElement(message, link, iframe, beforeText, afterText);
            } else if (twitterImageRegex.test(url)) {
                replaceWithImage(message, link, url, beforeText, afterText);
            } else if (mp4Regex.test(url)) {
                replaceWithVideo(message, link, url, beforeText, afterText);
            } else {
                replaceWithImage(message, link, url, beforeText, afterText);
            }
            link.classList.add('processed');
            return;
        }

        let textContent = message.textContent;
        let replaced = false;
        for (const alt in altToEmojiMap) {
            if (textContent.includes(alt)) {
                replaced = true;
                const emoji = altToEmojiMap[alt];
                const img = document.createElement('img');
                img.src = emoji.src;
                img.style.maxWidth = '200px';
                img.style.maxHeight = '200px';
                img.style.cursor = 'pointer';
                img.onclick = () => window.open(emoji.src, '_blank');

                const beforeText = textContent.substring(0, textContent.indexOf(alt));
                const afterText = textContent.substring(textContent.indexOf(alt) + alt.length);

                const container = document.createElement('span');
                if (beforeText) container.appendChild(document.createTextNode(beforeText));
                container.appendChild(img);
                if (afterText) container.appendChild(document.createTextNode(afterText));

                message.innerHTML = '';
                message.appendChild(container);
                break;
            }
        }

        if (replaced) {
            message.classList.add('processed');
        }
    }

    // 替換為圖片
    function replaceWithImage(message, link, url, beforeText, afterText) {
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.cursor = 'pointer';
        img.onclick = () => window.open(url, '_blank');
        img.onload = () => replaceLinkWithElement(message, link, img, beforeText, afterText);
    }

    // 替換為影片
    function replaceWithVideo(message, link, url, beforeText, afterText) {
        const video = document.createElement('video');
        video.src = url;
        video.style.maxWidth = '300px';
        video.style.maxHeight = '200px';
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.onloadeddata = () => replaceLinkWithElement(message, link, video, beforeText, afterText);
    }

    // 通用的替換函數
    function replaceLinkWithElement(message, link, element, beforeText, afterText) {
        const container = document.createElement('span');
        if (beforeText) container.appendChild(document.createTextNode(beforeText));
        container.appendChild(element);
        if (afterText) container.appendChild(document.createTextNode(afterText));
        message.innerHTML = '';
        message.appendChild(container);
    }

    // 儲存和獲取 BTTV 自訂圖片
    function getSavedBTTVEmojis() {
        return GM_getValue('customBTTVEmojis', []);
    }

    function saveBTTVEmoji(url) {
        const emojis = getSavedBTTVEmojis();
        if (!emojis.includes(url)) {
            emojis.push(url);
            GM_setValue('customBTTVEmojis', emojis);
        }
    }

    function deleteBTTVEmoji(url) {
        const emojis = getSavedBTTVEmojis();
        const updatedEmojis = emojis.filter(emoji => emoji !== url);
        GM_setValue('customBTTVEmojis', updatedEmojis);
    }

    // React 實例獲取
    function getReactInstance(element) {
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                return element[key];
            }
        }
        return null;
    }

    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        if (!node || depth > maxDepth) return null;
        try {
            if (predicate(node)) return node;
        } catch (_) {}
        return searchReactParents(node.return, predicate, maxDepth, depth + 1);
    }

    function getChatInput(element) {
        return searchReactParents(
            getReactInstance(element),
            (n) => n.memoizedProps && n.memoizedProps.componentType != null && n.memoizedProps.value != null
        );
    }

    function getChatInputEditor(element) {
        const editorNode = searchReactParents(
            getReactInstance(element),
            (n) => n.stateNode?.state?.slateEditor != null
        );
        return editorNode?.stateNode;
    }

    function updateChatInput(textbox, text) {
        const chatInput = getChatInput(textbox);
        const chatInputEditor = getChatInputEditor(textbox);

        if (!chatInput) return;

        const currentInput = chatInput.memoizedProps.value || '';
        const newText = currentInput + (currentInput ? ' ' : '') + text;

        chatInput.memoizedProps.value = newText;
        chatInput.memoizedProps.setInputValue(newText);
        chatInput.memoizedProps.onValueUpdate(newText);

        if (chatInputEditor) {
            chatInputEditor.focus();
        } else {
            textbox.focus();
        }
    }

    function insertEmojiUrl(url) {
        if (!cachedTextbox) {
            cachedTextbox = document.querySelector(TEXTBOX_SELECTOR);
        }
        if (!cachedTextbox) return;
        updateChatInput(cachedTextbox, url);
    }

    // 創建表情面板
    function createEmojiPanel() {
        const panel = document.createElement('div');
        panel.id = 'custom-emoji-panel';
        panel.style.position = 'fixed';
        panel.style.backgroundColor = '#18181b';
        panel.style.border = '1px solid #2e2e2e';
        panel.style.borderRadius = '5px';
        panel.style.zIndex = '999999';
        panel.style.display = 'none';
        panel.style.width = '350px';
        panel.style.height = '400px';
        panel.style.overflow = 'hidden';

        const header = document.createElement('div');
        header.style.backgroundColor = '#2e2e2e';
        header.style.padding = '5px';
        header.style.cursor = 'move';
        header.style.textAlign = 'center';
        header.style.color = 'white';
        header.innerText = '自訂表情';
        panel.appendChild(header);

        const tabContainer = document.createElement('div');
        tabContainer.style.display = 'flex';
        tabContainer.style.flexWrap = 'wrap';
        tabContainer.style.backgroundColor = '#1f1f23';
        tabContainer.style.padding = '5px';
        tabContainer.style.borderBottom = '1px solid #2e2e2e';
        panel.appendChild(tabContainer);

        const contentContainer = document.createElement('div');
        contentContainer.style.height = 'calc(100% - 70px)';
        contentContainer.style.overflowY = 'auto';
        contentContainer.style.padding = '10px';
        panel.appendChild(contentContainer);

        const tabs = {};
        Object.keys(emojiLists).forEach(listname => {
            const image = emojiLists[listname].image;

            const tabButton = document.createElement('button');
            tabButton.style.backgroundImage = `url(${image})`;
            tabButton.style.backgroundSize = 'cover';
            tabButton.style.backgroundPosition = 'center';
            tabButton.style.width = '32px';
            tabButton.style.height = '32px';
            tabButton.style.padding = '0';
            tabButton.style.margin = '2px';
            tabButton.style.backgroundColor = '#2e2e2e';
            tabButton.style.border = 'none';
            tabButton.style.borderRadius = '3px';
            tabButton.style.cursor = 'pointer';
            tabButton.style.transition = 'background-color 0.2s, opacity 0.2s';
            tabButton.title = listname; // 懸停提示顯示標籤名稱

            // 圖片加載錯誤處理
            const img = new Image();
            img.src = image;
            img.onerror = () => {
                tabButton.style.backgroundImage = `url('https://via.placeholder.com/32?text=${listname[0]}')`;
                tabButton.style.opacity = '0.7';
            };

            const tabContent = document.createElement('div');
            tabContent.style.display = 'none';
            tabContent.style.flexWrap = 'wrap';
            tabContent.style.gap = '5px';

            tabButton.addEventListener('click', () => {
                Object.values(tabs).forEach(t => {
                    t.button.style.backgroundColor = '#2e2e2e';
                    t.content.style.display = 'none';
                });
                tabButton.style.backgroundColor = '#9146FF';
                tabContent.style.display = 'flex';
            });

            tabs[listname] = { button: tabButton, content: tabContent };
            tabContainer.appendChild(tabButton);
            contentContainer.appendChild(tabContent);
        });

        const firstTab = Object.values(tabs)[0];
        if (firstTab) {
            firstTab.button.style.backgroundColor = '#9146FF';
            firstTab.content.style.display = 'flex';
        }

        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;

        header.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isDragging = true;
            initialX = e.clientX - currentX;
            initialY = e.clientY - currentY;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                panel.style.left = `${currentX}px`;
                panel.style.top = `${currentY}px`;
                panel.style.transform = '';
            }
        }

        function onMouseUp(e) {
            e.stopPropagation();
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        const centerPanel = () => {
            const panelRect = panel.getBoundingClientRect();
            currentX = (window.innerWidth - panelRect.width) / 2;
            currentY = (window.innerHeight - panelRect.height) / 2;
            panel.style.left = `${currentX}px`;
            panel.style.top = `${currentY}px`;
        };

        centerPanel();

        const resizeListener = throttle(() => {
            if (!isDragging) centerPanel();
        }, 100);
        window.addEventListener('resize', resizeListener);

        return { panel, tabs, centerPanel, cleanup: () => window.removeEventListener('resize', resizeListener) };
    }

    let isDeleteMode = false;

    // 更新表情面板內容
    function updateEmojiPanel(panel, tabs) {
        Object.keys(emojiLists).forEach(listname => {
            const tabContent = tabs[listname].content;
            tabContent.innerHTML = '';

            if (listname === "BTTV") {
                const inputContainer = document.createElement('div');
                inputContainer.style.marginBottom = '10px';
                inputContainer.style.display = 'flex';
                inputContainer.style.gap = '5px';

                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = '輸入圖片網址';
                input.style.width = '60%';
                input.style.padding = '5px';
                input.style.backgroundColor = '#2e2e2e';
                input.style.color = 'white';
                input.style.border = '1px solid #444';
                input.style.borderRadius = '3px';

                const addButton = document.createElement('button');
                addButton.innerText = '儲存';
                addButton.style.padding = '5px 10px';
                addButton.style.backgroundColor = '#9146FF';
                addButton.style.color = 'white';
                addButton.style.border = 'none';
                addButton.style.borderRadius = '3px';
                addButton.style.cursor = 'pointer';

                addButton.onclick = (e) => {
                    e.stopPropagation();
                    const url = input.value.trim();
                    if (url) {
                        saveBTTVEmoji(url);
                        emojiLists["BTTV"].emojis.push({ alt: url.split('/').pop(), src: url, dis: url });
                        altToEmojiMap[url.split('/').pop()] = { src: url, width: '32', height: '32' };
                        input.value = '';
                        updateEmojiPanel(panel, tabs);
                    }
                };

                const deleteModeButton = document.createElement('button');
                deleteModeButton.innerText = isDeleteMode ? '取消' : '刪除';
                deleteModeButton.style.padding = '5px 10px';
                deleteModeButton.style.backgroundColor = isDeleteMode ? '#666' : 'red';
                deleteModeButton.style.color = 'white';
                deleteModeButton.style.border = 'none';
                deleteModeButton.style.borderRadius = '3px';
                deleteModeButton.style.cursor = 'pointer';

                deleteModeButton.onclick = (e) => {
                    e.stopPropagation();
                    isDeleteMode = !isDeleteMode;
                    deleteModeButton.innerText = isDeleteMode ? '取消' : '刪除';
                    deleteModeButton.style.backgroundColor = isDeleteMode ? '#666' : 'red';
                    updateEmojiPanel(panel, tabs);
                };

                inputContainer.appendChild(input);
                inputContainer.appendChild(addButton);
                inputContainer.appendChild(deleteModeButton);
                tabContent.appendChild(inputContainer);

                const customEmojis = emojiLists["BTTV"].emojis;
                customEmojis.forEach(emoji => {
                    const container = document.createElement('div');
                    container.style.display = 'inline-block';
                    container.style.position = 'relative';

                    const img = document.createElement('img');
                    img.src = emoji.src;
                    img.style.width = '32px';
                    img.style.height = '32px';
                    img.style.cursor = 'pointer';
                    img.title = emoji.dis;
                    img.onclick = (e) => {
                        e.stopPropagation();
                        insertEmojiUrl(emoji.src);
                        panel.style.display = 'none';
                    };
                    img.onerror = () => img.style.display = 'none';

                    container.appendChild(img);

                    if (isDeleteMode) {
                        const deleteButton = document.createElement('button');
                        deleteButton.innerText = '×';
                        deleteButton.style.position = 'absolute';
                        deleteButton.style.top = '-5px';
                        deleteButton.style.right = '-5px';
                        deleteButton.style.width = '16px';
                        deleteButton.style.height = '16px';
                        deleteButton.style.backgroundColor = 'red';
                        deleteButton.style.color = 'white';
                        deleteButton.style.border = 'none';
                        deleteButton.style.borderRadius = '50%';
                        deleteButton.style.fontSize = '12px';
                        deleteButton.style.lineHeight = '16px';
                        deleteButton.style.textAlign = 'center';
                        deleteButton.style.cursor = 'pointer';
                        deleteButton.style.transition = 'background-color 0.2s';

                        deleteButton.onmouseover = () => deleteButton.style.backgroundColor = '#cc0000';
                        deleteButton.onmouseout = () => deleteButton.style.backgroundColor = 'red';

                        deleteButton.onclick = (e) => {
                            e.stopPropagation();
                            deleteBTTVEmoji(emoji.src);
                            emojiLists["BTTV"].emojis = emojiLists["BTTV"].emojis.filter(e => e.src !== emoji.src);
                            delete altToEmojiMap[emoji.alt];
                            updateEmojiPanel(panel, tabs);
                        };

                        container.appendChild(deleteButton);
                    }

                    tabContent.appendChild(container);
                });
                return;
            }

            const emojis = emojiLists[listname].emojis || [];
            emojis.forEach(emoji => {
                const container = document.createElement('div');
                container.style.display = 'inline-block';

                const img = document.createElement('img');
                img.src = emoji.src;
                img.style.width = '32px';
                img.style.height = '32px';
                img.style.cursor = 'pointer';
                img.title = emoji.dis || emoji.alt || '';
                img.onclick = (e) => {
                    e.stopPropagation();
                    insertEmojiUrl(emoji.alt || emoji.src);
                    panel.style.display = 'none';
                };
                img.onerror = () => img.style.display = 'none';

                container.appendChild(img);
                tabContent.appendChild(container);
            });
        });
    }

    // 替換表情按鈕並添加自訂面板
    function replaceEmoteButton(scrollableArea) {
        const emoteButton = document.querySelector('[data-a-target="emote-picker-button"]');
        if (!emoteButton) return;

        const customButton = document.createElement('button');
        customButton.innerHTML = '<img src="https://forumd.hkgolden.com/faces/sosad.gif" width="21px" height="17px"/>';
        customButton.setAttribute('aria-label', '自訂表情面板');
        customButton.className = emoteButton.className;
        customButton.style.cursor = 'pointer';

        const { panel, tabs, centerPanel, cleanup } = createEmojiPanel();
        document.body.appendChild(panel);

        let isPanelVisible = false;
        const onButtonClick = (e) => {
            e.stopPropagation();
            isPanelVisible = !isPanelVisible;
            panel.style.display = isPanelVisible ? 'block' : 'none';
            if (isPanelVisible) {
                centerPanel();
                updateEmojiPanel(panel, tabs);
            } else {
                isDeleteMode = false;
            }
        };

        const onDocumentClick = (e) => {
            if (!panel.contains(e.target) && e.target !== customButton) {
                panel.style.display = 'none';
                isPanelVisible = false;
                isDeleteMode = false;
            }
        };

        customButton.addEventListener('click', onButtonClick);
        document.addEventListener('click', onDocumentClick);

        emoteButton.parentNode.replaceChild(customButton, emoteButton);

        return () => {
            customButton.removeEventListener('click', onButtonClick);
            document.removeEventListener('click', onDocumentClick);
            cleanup();
            panel.remove();
        };
    }

    // 初始化並監聽聊天室
    function initializeObserver() {
        const chatContainer = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
        if (!chatContainer) return false;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        const messages = node.querySelectorAll('[data-a-target="chat-line-message-body"]');
                        messages.forEach(processMessage);
                    });
                }
            });
        });

        observer.observe(chatContainer, { childList: true, subtree: true });

        const existingMessages = chatContainer.querySelectorAll('[data-a-target="chat-line-message-body"]');
        existingMessages.forEach(processMessage);

        const cleanupEmoteButton = replaceEmoteButton(chatContainer);

        return () => {
            observer.disconnect();
            cleanupEmoteButton();
        };
    }

    // 等待聊天室載入並初始化
    function waitForChat() {
        let cleanup = null;
        const maxAttempts = 20;
        let attempts = 0;
        const interval = setInterval(() => {
            if (Object.keys(emojiLists).length === 0) {
                loadEmojiSets(() => {
                    const result = initializeObserver();
                    if (result || attempts >= maxAttempts) {
                        clearInterval(interval);
                        if (result) cleanup = result;
                    }
                    attempts++;
                });
            } else {
                const result = initializeObserver();
                if (result || attempts >= maxAttempts) {
                    clearInterval(interval);
                    if (result) cleanup = result;
                }
                attempts++;
            }
        }, 500);

        return () => {
            clearInterval(interval);
            if (cleanup) cleanup();
        };
    }

    // 頁面載入後執行
    const cleanupWaitForChat = waitForChat();
    window.addEventListener('load', waitForChat);

    window.addEventListener('unload', () => {
        cleanupWaitForChat();
    });
})();