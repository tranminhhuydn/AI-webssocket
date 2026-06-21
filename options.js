(() => {
    let domain = "";

    const UI = {};

    function bindUI() {
        document.querySelectorAll("[id]").forEach(el => {
            UI[el.id] = el;
        });
    }

    function getCurrentDomain() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab?.url) return resolve("");

                try {
                    const host = new URL(tab.url).hostname;
                    resolve(host);
                } catch (e) {
                    resolve("");
                }
            });
        });
    }

    function loadStorage() {
        chrome.storage.sync.get(["domainToggle", "inPort"], (res) => {
            const list = res.domainToggle || [];

            UI.domainToggle.checked = list.includes(domain);
            UI.inPort.value = res.inPort || 5050;
        });
    }

    function saveDomainToggle() {
        UI.domainToggle.addEventListener("change", () => {
            chrome.storage.sync.get(["domainToggle"], (res) => {
                let list = res.domainToggle || [];

                if (UI.domainToggle.checked) {
                    if (!list.includes(domain)) list.push(domain);
                } else {
                    list = list.filter(d => d !== domain);
                }

                chrome.storage.sync.set({ domainToggle: list });
            });
        });
    }

    function savePort() {
        UI.inPort.addEventListener("change", () => {
            chrome.storage.sync.set({ inPort: UI.inPort.value });
        });
    }

    function bindEvents() {
       
        // connect WS
        UI.cmdConnectWS.addEventListener("click", () => {
            chrome.runtime.sendMessage(
                { action: "connectWS", port: UI.inPort.value },
                (res) => {
                    console.log("📩 background response:", res);
                }
            );
            UI.cmdConnectWS.textContent =
                UI.cmdConnectWS.textContent === "✅ Connect" ? "❌ Disconnect" : "✅ Connect";
        });

        saveDomainToggle();
        savePort();
    }

    async function init() {
        console.log("[options.js] init");

        bindUI();

        domain = await getCurrentDomain();

        if (UI.domainLabel) {
            UI.domainLabel.textContent = `Cho phép ${domain}`;
        }

        if (UI.domainLabelTTS) {
            UI.domainLabelTTS.textContent = domain;
        }

        loadStorage();
        bindEvents();

        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

            if (msg.type === "WS_CONNECTED") {
                console.log("Popup nhận được: đã kết nối");
                UI.cmdConnectWS.textContent = "✅ Connect"
            }

            if (msg.type === "WS_DISCONNECTED") {
                console.log("Popup nhận được: mất kết nối");
                UI.cmdConnectWS.textContent = "❌ Disconnect"
            }

        });

    }

    document.addEventListener("DOMContentLoaded", init);
})();