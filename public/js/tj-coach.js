/**

 * Outreach Assistant — bottom-right GPT help chat (via /api/coach/chat).

 * Requires sign-in (TJFetch + Firebase Auth). UI loads on all shell pages.

 */

(function () {

  var MAX_HISTORY = 10;

  var MAX_INPUT = 500;



  var page = (function () {

    var p = window.location.pathname;

    var q = window.location.search;

    if (p.indexOf("email.html") >= 0) return "email";

    if (p.indexOf("campaigns.html") >= 0) return "campaigns";

    if (q.indexOf("view=pipeline") >= 0) return "pipeline";

    if (q.indexOf("view=dashboard") >= 0 || p === "/" || p.indexOf("leads.html") >= 0) return "dashboard";

    return "other";

  })();



  var PAGE_TIPS = {

    email: [

      {label: "How do I send an email?", q: "How do I send a new outreach email?"},

      {label: "What are follow-ups?", q: "How do follow-up emails work?"},

      {label: "How does approval work?", q: "How does manual approval for follow-ups work?"},

    ],

    campaigns: [

      {label: "How do bulk sends work?", q: "How do Campaigns and bulk sending work?"},

      {label: "What are follow-ups?", q: "How do follow-up emails work in campaigns?"},

      {label: "How does approval work?", q: "How does draft approval work?"},

    ],

    pipeline: [

      {label: "What does yellow mean?", q: "What does a yellow row mean in Pipeline?"},

      {label: "What does red mean?", q: "What does a red row mean in Pipeline?"},

      {label: "How do I approve a draft?", q: "How do I approve an AI draft in Pipeline?"},

      {label: "Stop emails to someone", q: "How do I stop follow-ups for a contact?"},

    ],

    dashboard: [

      {label: "How do I send an email?", q: "How do I send a new outreach email?"},

      {label: "What do the colors mean?", q: "What do Pipeline row colors mean?"},

      {label: "What are campaigns?", q: "What are Campaigns used for?"},

    ],

    other: [

      {label: "Pipeline colors", q: "What do Pipeline row colors mean?"},

      {label: "How do I send?", q: "How do I send a new outreach email?"},

      {label: "What are follow-ups?", q: "How do follow-up emails work?"},

    ],

  };



  function el(tag, cls, html) {

    var e = document.createElement(tag);

    if (cls) e.className = cls;

    if (html != null) e.innerHTML = html;

    return e;

  }



  function escapeHtml(s) {

    return String(s || "")

      .replace(/&/g, "&amp;")

      .replace(/</g, "&lt;")

      .replace(/>/g, "&gt;")

      .replace(/"/g, "&quot;");

  }



  var APP_ROUTES = [
    ["/leads.html?view=dashboard", "Dashboard"],
    ["/leads.html?view=pipeline", "Pipeline"],
    ["/email.html", "Send email"],
    ["/campaigns.html", "Campaigns"],
    ["/leads.html", "Leads"],
  ];

  var SAFE_PATH_RE = /^\/[a-zA-Z0-9_\-./?=&]+$/;

  function trimPathPunctuation(path) {
    var p = String(path || "");
    while (p.length && ".,);:".indexOf(p.charAt(p.length - 1)) >= 0) {
      p = p.slice(0, -1);
    }
    return p;
  }

  function labelForPath(path) {
    for (var i = 0; i < APP_ROUTES.length; i++) {
      if (APP_ROUTES[i][0] === path) return APP_ROUTES[i][1];
    }
    return path;
  }

  function coachLink(href, label) {
    var p = trimPathPunctuation(href);
    if (!SAFE_PATH_RE.test(p)) return escapeHtml(label || href);
    var text = label || labelForPath(p);
    return (
      '<a class="tj-coach-link" href="' +
      escapeHtml(p) +
      '">' +
      escapeHtml(text) +
      "</a>"
    );
  }

  /** Plain text / light markdown → safe HTML for bot bubbles. */
  function formatBotReply(text) {
    var s = escapeHtml(String(text || "").trim());
    s = s.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, function (_, label, path) {
      return coachLink(path, label);
    });
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/(^|[^\w"=\/<>;])(\/[a-zA-Z0-9_\-./?=&]+)/g, function (match, prefix, rawPath) {
      var trail = "";
      var path = rawPath;
      while (path.length && ".,);:".indexOf(path.charAt(path.length - 1)) >= 0) {
        trail = path.charAt(path.length - 1) + trail;
        path = path.slice(0, -1);
      }
      if (!SAFE_PATH_RE.test(path)) return match;
      return prefix + coachLink(path, labelForPath(path)) + trail;
    });
    s = s.replace(/\n/g, "<br>");
    return s;
  }



  function buildWidget() {

    var wrap = el("div", "tj-coach-wrap");

    var chatHistory = [];

    var busy = false;



    var btnWrap = el("div", "tj-coach-btn-wrap");

    var ripple1 = el("span", "tj-coach-ripple");

    var ripple2 = el("span", "tj-coach-ripple tj-coach-ripple--delay");

    var btn = el("button", "tj-coach-btn", "");

    btn.setAttribute("aria-label", "Open Outreach Assistant");

    btn.setAttribute("title", "Outreach Assistant");

    btn.innerHTML =

      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +

      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +

      "</svg>";

    btnWrap.appendChild(ripple1);

    btnWrap.appendChild(ripple2);

    btnWrap.appendChild(btn);

    ripple1.addEventListener("animationend", function (ev) {

      if (ev && ev.target) ev.target.remove();

    });

    ripple2.addEventListener("animationend", function (ev) {

      if (ev && ev.target) ev.target.remove();

    });



    var panel = el("div", "tj-coach-panel");

    panel.setAttribute("role", "dialog");

    panel.setAttribute("aria-label", "Outreach Assistant");

    panel.hidden = true;



    var header = el("div", "tj-coach-header");

    var title = el("div", "tj-coach-title", "Outreach Assistant");

    var closeBtn = el("button", "tj-coach-close", "×");

    closeBtn.setAttribute("aria-label", "Close assistant");

    header.appendChild(title);

    header.appendChild(closeBtn);



    var body = el("div", "tj-coach-body");

    var msgs = el("div", "tj-coach-msgs");

    msgs.setAttribute("aria-live", "polite");



    var chips = el("div", "tj-coach-chips");

    var tips = PAGE_TIPS[page] || PAGE_TIPS.other;

    for (var i = 0; i < tips.length; i++) {

      (function (tip) {

        var chip = el("button", "tj-coach-chip", tip.label);

        chip.addEventListener("click", function () {

          sendUserMessage(tip.q);

        });

        chips.appendChild(chip);

      })(tips[i]);

    }



    var inputRow = el("div", "tj-coach-input-row");

    var input = el("input", "tj-coach-input");

    input.setAttribute("type", "text");

    input.setAttribute("placeholder", "Ask about the app…");

    input.setAttribute("autocomplete", "off");

    input.setAttribute("maxlength", String(MAX_INPUT));

    var sendBtn = el("button", "tj-coach-send", "");

    sendBtn.setAttribute("aria-label", "Send");

    sendBtn.innerHTML =

      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +

      '<path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2z"/>' +

      "</svg>";



    inputRow.appendChild(input);

    inputRow.appendChild(sendBtn);

    body.appendChild(msgs);

    body.appendChild(chips);

    body.appendChild(inputRow);

    panel.appendChild(header);

    panel.appendChild(body);

    wrap.appendChild(panel);

    wrap.appendChild(btnWrap);



    var greetings = {

      email: "Need help sending an email? Pick a topic or ask me anything about the app.",

      campaigns: "Setting up a campaign? Ask me anything.",

      pipeline: "Checking your pipeline? Ask about colors, replies, or approvals.",

      dashboard: "Hi — ask me anything about Lead Automation.",

      other: "Hi — I can help you use Outreach Platform. Ask me anything.",

    };

    addMessage("bot", greetings[page] || greetings.other);

    function addMessage(role, content) {
      var msg = el("div", "tj-coach-msg tj-coach-msg--" + role);
      if (role === "user") {
        msg.textContent = content;
      } else {
        msg.innerHTML = formatBotReply(content);
      }
      msgs.appendChild(msg);
      msgs.scrollTop = msgs.scrollHeight;
      return msg;
    }

    msgs.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var link = t.closest("a.tj-coach-link");
      if (!link) return;
      panel.classList.remove("tj-coach-panel--open");
      panel.hidden = true;
    });



    var typingEl = null;



    function showTyping() {

      if (typingEl) return;

      typingEl = el("div", "tj-coach-msg tj-coach-msg--bot tj-coach-msg--typing");

      typingEl.innerHTML =

        '<span class="tj-coach-typing-dot"></span><span class="tj-coach-typing-dot"></span><span class="tj-coach-typing-dot"></span>';

      msgs.appendChild(typingEl);

      msgs.scrollTop = msgs.scrollHeight;

    }



    function hideTyping() {

      if (typingEl && typingEl.parentNode) {

        typingEl.parentNode.removeChild(typingEl);

      }

      typingEl = null;

    }



    function setBusy(on) {

      busy = on;

      sendBtn.disabled = on;

      input.disabled = on;

    }



    function trimHistory() {

      while (chatHistory.length > MAX_HISTORY * 2) {

        chatHistory.shift();

      }

    }



    async function askCoach(userText) {

      if (typeof window.TJFetch !== "function") {

        return {

          error: "Sign in to use the assistant. Open the app and sign in with your Outreach Platform Google account.",

        };

      }

      chatHistory.push({role: "user", content: userText});

      trimHistory();

      try {

        var resp = await window.TJFetch("/api/coach/chat", {

          method: "POST",

          headers: {"Content-Type": "application/json"},

          body: JSON.stringify({page: page, messages: chatHistory}),

        });

        var data = await resp.json().catch(function () {

          return {};

        });

        if (!resp.ok) {

          chatHistory.pop();

          var errMsg =

            (data && data.error) ||

            (resp.status === 401

              ? "Please sign in to use the assistant."

              : resp.status === 429

                ? "Too many questions — wait a minute and try again."

                : "Could not reach the assistant. Try again in a moment.");

          return {error: errMsg};

        }

        var reply = data && data.reply ? String(data.reply) : "";

        if (!reply) {

          chatHistory.pop();

          return {error: "Empty response. Please try again."};

        }

        chatHistory.push({role: "assistant", content: reply});

        trimHistory();

        return {reply: reply};

      } catch (e) {

        chatHistory.pop();

        if (e && e.code === "auth_required") {

          return {error: "Please sign in to use the assistant."};

        }

        return {error: "Network error. Check your connection and try again."};

      }

    }



    async function sendUserMessage(text) {

      var q = String(text || "").trim();

      if (!q || busy) return;

      chips.style.display = "none";

      addMessage("user", q);

      input.value = "";

      setBusy(true);

      showTyping();

      var result = await askCoach(q);

      hideTyping();

      setBusy(false);

      if (result.error) {

        addMessage("bot", result.error);

      } else {

        addMessage("bot", result.reply);

      }

    }



    function submit() {

      sendUserMessage(input.value.trim());

    }



    sendBtn.addEventListener("click", submit);

    input.addEventListener("keydown", function (e) {

      if (e.key === "Enter" && !e.shiftKey) {

        e.preventDefault();

        submit();

      }

    });



    closeBtn.addEventListener("click", function () {

      panel.hidden = true;

      panel.classList.remove("tj-coach-panel--open");

    });



    btn.addEventListener("click", function () {

      var isOpen = !panel.hidden;

      if (isOpen) {

        panel.classList.remove("tj-coach-panel--open");

        setTimeout(function () {

          panel.hidden = true;

        }, 220);

      } else {

        panel.hidden = false;

        requestAnimationFrame(function () {

          panel.classList.add("tj-coach-panel--open");

        });

        setTimeout(function () {

          input.focus();

        }, 250);

      }

    });



    return wrap;

  }



  function mount() {

    if (document.getElementById("tjCoachRoot")) return;

    var root = buildWidget();

    root.id = "tjCoachRoot";

    document.body.appendChild(root);

  }



  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", mount);

  } else {

    mount();

  }

})();


