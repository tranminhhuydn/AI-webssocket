(() => {
  let ttsEnabled = false;
  let lastSubtitle = "";
  let audioCtx = null; // giữ 1 audio context dùng chung
  let audio = new Audio();
  let debounceTimer = null;

  // Hàng đợi audio
  let audioQueue = [];
  let isPlaying = false;
  var condition = true
  let box


  window.addEventListener("load", () => {
    // console.log("✅ Trang đã load xong (onload).");
    const domain = window.location.hostname;
    chrome.storage.sync.get(["domainToggle"], (res) => {
      const list = res.domainToggle || [];
      // console.log(`list`,list);
      // console.log(`✅ domainToggle (${domain}).`);
      if (list.includes(domain)) {
        findComposerGPT();
        box = findComposer(); if (!box) { alert("❌ Không thấy ô nhập"); return; }
      } else {
        console.log("⛔ Chặn:", domain);
      }
    });

  });


  const findComposer = () => {
    const nodes = document.querySelectorAll('textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"]');
    let best = null, bottom = -1;
    nodes.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 20 && r.bottom > bottom) { best = el; bottom = r.bottom; }
    });
    return best;
  };


  var actionList = {
    doingGPT: (msg) => {
      setTimeout(() => box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" })), 120);

      console.log("doingGPT", msg);
      if (box.tagName.toLowerCase() === "textarea") {
        box.value = msg; box.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        box.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, msg.text);
        box.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    console.log(msg.action);
    if (actionList[msg.action]) {
      actionList[msg.action](msg);
    } else {
      console.log("Không có action:", msg.action);
    }

  });

  // ================ tính lăng lắng nghe câu trả lời ================

  function addMessageWithTimestamp(text) {
    const now = new Date();
    const ts = now.toLocaleTimeString();
    const msg = `[${ts}] ${text}`;
    console.log(msg);

    //<button type="button" class="flex gap-1 items-center select-none py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 size-9 rounded-full px-2" aria-label="Sao chép" data-state="instant-open" aria-describedby="radix-_r_u5_">
    // <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon-md"><use href="/cdn/assets/sprites-core-9c5054d5.svg#ce3544" fill="currentColor"></use></svg>
    // </button>
    // document.querySelector('[data-testid="copy-turn-action-button"]')?.click();

    //const btns1 = document.querySelectorAll('[data-state="instant-open"]');

    const btns = document.querySelectorAll('[data-testid="copy-turn-action-button"]');
    btns[btns.length - 1]?.click();


    navigator.clipboard.readText().then(clipboard => {
      console.log("Dữ liệu clipboard:", clipboard);
      chrome.runtime.sendMessage({
        action: "answerGPT",
        text: `[${ts}] ${clipboard}`
      }, (response) => {
        console.log("📩 Phản hồi từ background:", response);
      })

    });

  }

  let debounceTimerGPT = null;
  let debounceTimerGPTCopy = null;
  

  function findComposerGPT() {

    installCopyListener();
    installCopyListenerGemini()
    // const target = document.querySelector("main");

    // if (!target) return;

    // const observer = new MutationObserver(() => {

    //   const messages =
    //     target.querySelectorAll(
    //       "[data-message-author-role='assistant']"
    //     );

    //   const last = messages[messages.length - 1];

    //   if (!last) return;

    //   if (debounceTimerGPT)
    //     clearTimeout(debounceTimerGPT);

    //   debounceTimerGPT = setTimeout(() => {

    //     const txt = last.innerText.trim();

    //     if (txt && last.dataset.logged !== txt) {

    //       last.dataset.logged = txt;

    //       console.log("GPT finished");

    //     }

    //   }, 800);

    // });

    // observer.observe(target, {
    //   childList: true,
    //   subtree: true,
    //   characterData: true
    // });

  }

  function installCopyListener() {

    if (window.copyListenerInstalled) return;
    window.copyListenerInstalled = true;

    document.addEventListener("click", async (e) => {

      const btn = e.target.closest(
        '[data-testid="copy-turn-action-button"]'
      );

      if (!btn) return;

      console.log("📋 Copy button clicked");

      // đợi ChatGPT ghi vào clipboard
      setTimeout(async () => {

        try {

          const clipboard = await navigator.clipboard.readText();

          console.log("Clipboard:", clipboard);

          chrome.runtime.sendMessage({
            action: "answerGPT",
            text: clipboard
          });

        } catch (err) {
          console.error("Clipboard error:", err);
        }

      }, 500);

    });

    console.log("✅ Copy listener installed");
  }

  //<mat-icon _ngcontent-ng-c4169960006="" 
  // role="img" 
  // class="mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" 
  // aria-hidden="true" 
  // data-mat-icon-type="font" 
  // data-mat-icon-name="copy" 
  // data-mat-icon-namespace="lumi-symbols" fonticon="copy"></mat-icon>

  function installCopyListenerGemini() {
    console.log('[installCopyListenerGemini]');
    
    if (window.copyListenerInstalledGemini) return;
    window.copyListenerInstalledGemini = true;

    document.addEventListener("click", async (e) => {

      const btn = e.target.closest(
        '[data-mat-icon-name="copy"]'
      );

      if (!btn) return;

      console.log("📋 Copy button clicked");

      // đợi ChatGPT ghi vào clipboard
      setTimeout(async () => {

        try {

          const clipboard = await navigator.clipboard.readText();

          console.log("Clipboard:", clipboard);

          chrome.runtime.sendMessage({
            action: "answerGPT",
            text: clipboard
          });

        } catch (err) {
          console.error("Clipboard error:", err);
        }

      }, 500);

    });

    console.log("✅ Copy listener installed");
  }
})();