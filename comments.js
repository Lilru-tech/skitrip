const COMMENTS_API_URL = "https://script.google.com/macros/s/AKfycbxiZhDqPpPTAV4En1UHysdFFljXNpdpi65WEGQQkHCuTjRLjHVdic60duPHmorRrTq4OQ/exec"; // .../exec

let currentResortId = null;
let currentResortName = "";

function $(id) { return document.getElementById(id); }

function getCommentUser() {
  const el = $("commentUserInput");
  const v = (el?.value || localStorage.getItem("skitrip_comment_user") || "").trim();
  return v;
}

function saveCommentUserToLocalStorage() {
  const v = ( $("commentUserInput")?.value || "" ).trim();
  if (v) localStorage.setItem("skitrip_comment_user", v);
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__jsonp_cb_" + Math.random().toString(36).slice(2);
  
      const script = document.createElement("script");
      const cleanup = () => {
        try { delete window[cb]; } catch {}
        script.remove();
      };
  
      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };
  
      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed"));
      };
  
      const sep = url.includes("?") ? "&" : "?";
      script.src = `${url}${sep}callback=${encodeURIComponent(cb)}`;
      document.body.appendChild(script);
    });
  }

  async function apiList(resortId) {
    const url = `${COMMENTS_API_URL}?action=list&resort_id=${encodeURIComponent(resortId)}`;
    const data = await jsonp(url);
    return Array.isArray(data?.comments) ? data.comments : [];
  }

  async function apiPost(payload) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload || {})) {
      if (v == null) continue;
      params.set(k, String(v));
    }
    const url = `${COMMENTS_API_URL}?${params.toString()}`;
    return await jsonp(url);
  }

  function setCommentsSummary_(count, resortName) {
    const el = document.getElementById("commentsSummary");
    if (!el) return;
  
    const n = Number(count || 0);
  
    if (!n) {
      el.textContent = "Sin comentarios";
      return;
    }
  
    // Si quieres mostrar el nombre:
    // el.textContent = `${n} comentario${n === 1 ? "" : "s"} · ${resortName || "Global"}`;
  
    // Si lo prefieres simple:
    el.textContent = `${n} comentario${n === 1 ? "" : "s"}`;
  }
  
  async function refreshCommentsSummary_(resortId, resortName) {
    try {
      const comments = await apiList(resortId);
      setCommentsSummary_(comments.length, resortName);
    } catch (e) {
      // Si falla, no rompemos nada: dejamos el texto como está
      console.warn("[comments] summary refresh failed", e);
    }
  }

async function renderResortComments() {
  const list = $("commentsList");
  if (!list) return;

  if (!currentResortId) {
    list.innerHTML = `<div class="muted">Selecciona una estación.</div>`;
    return;
  }

  // Título modal dinámico
  const title = $("commentsTitle");
  if (title) title.textContent = `📝 Comentarios · ${currentResortName || currentResortId}`;

  list.innerHTML = `<div class="muted">Cargando comentarios…</div>`;

  const comments = await apiList(currentResortId);

  setCommentsSummary_(comments.length, currentResortName || currentResortId); // ✅ NUEVO

  if (!comments.length) {
    list.innerHTML = `<div class="muted">No hay comentarios para esta estación.</div>`;
    return;
  }

  list.innerHTML = comments.map(c => {
    const safeText = escapeHtml(c.text).replaceAll("\n", "<br>");
    return `
      <div class="commentItem" data-id="${c.id}">
<div class="commentMeta">
  <span class="muted">
    ${c.user ? `👤 ${escapeHtml(c.user)} · ` : ""}
    Actualizado: ${formatDate(c.updatedAt)}
  </span>
</div>

        <div class="commentText">${safeText}</div>

        <div class="commentActions">
          <button class="commentEditBtn secondary">Editar</button>
          <button class="commentDeleteBtn">Eliminar</button>
        </div>
      </div>
    `;
  }).join("");
}

async function addComment(text) {
  const t = (text || "").trim();
  if (!t || !currentResortId) return;

  const user = getCommentUser();
  saveCommentUserToLocalStorage();

  await apiPost({ action: "add", resort_id: currentResortId, text: t, user });
  await renderResortComments();
}

async function deleteComment(id) {
  if (!currentResortId) return;
  await apiPost({ action: "delete", resort_id: currentResortId, id });
  await renderResortComments();
}

function startEditComment(id, originalText) {
  const item = document.querySelector(`.commentItem[data-id="${id}"]`);
  if (!item) return;

  item.innerHTML = `
    <div class="commentMeta">
      <span class="muted">Editando…</span>
    </div>

    <textarea class="commentEditArea" rows="4">${escapeHtml(originalText || "")}</textarea>

    <div class="commentActions">
      <button class="commentSaveBtn secondary">Guardar</button>
      <button class="commentCancelBtn">Cancelar</button>
    </div>
  `;
}

async function saveEditComment(id, newText) {
  const t = (newText || "").trim();
  if (!t || !currentResortId) return;

  await apiPost({ action: "edit", resort_id: currentResortId, id, text: t });
  await renderResortComments();
}

function openCommentsModalForResort(resortId, resortName) {
    currentResortId = resortId || null;
    currentResortName = resortName || "";
  
    const input = $("commentInput");
    if (input) input.value = "";
    const userEl = $("commentUserInput");
if (userEl && !userEl.value) userEl.value = localStorage.getItem("skitrip_comment_user") || "";
  
    renderResortComments();
    $("commentsView")?.classList.remove("hidden");
  }

function wireCommentsUI() {
  const input = $("commentInput");
  const addBtn = $("addCommentBtn");
  const list = $("commentsList");

  addBtn?.addEventListener("click", async () => {
    await addComment(input.value);
    input.value = "";
  });

  input?.addEventListener("keydown", async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      await addComment(input.value);
      input.value = "";
    }
  });

  list?.addEventListener("click", async (e) => {
    const item = e.target.closest(".commentItem");
    if (!item) return;
    const id = item.getAttribute("data-id");
    if (!id) return;

    if (e.target.classList.contains("commentDeleteBtn")) {
      await deleteComment(id);
      return;
    }

    if (e.target.classList.contains("commentEditBtn")) {
      // coger el texto actual del item antes de reemplazarlo
      const textEl = item.querySelector(".commentText");
      const raw = textEl ? textEl.innerText : "";
      startEditComment(id, raw);
      return;
    }

    if (e.target.classList.contains("commentCancelBtn")) {
      await renderResortComments();
      return;
    }

    if (e.target.classList.contains("commentSaveBtn")) {
      const area = item.querySelector(".commentEditArea");
      await saveEditComment(id, area ? area.value : "");
      return;
    }
  });
}

// Exponemos para que app.js lo llame al clicar una estación
window.openCommentsModalForResort = openCommentsModalForResort;

document.addEventListener("DOMContentLoaded", () => {
    wireCommentsUI();
    refreshCommentsSummary_("global", "Global"); // ✅ NUEVO
  });