/* Translation History — loads entries from TranslationCache and renders a table. */

document.addEventListener('DOMContentLoaded', async () => {
  const tableContainer = document.getElementById('historyTable');
  const clearAllBtn = document.getElementById('clearAll');
  const overlay = document.getElementById('previewOverlay');

  if (!tableContainer) return;

  document
    .getElementById('previewClose')
    .addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') overlay.classList.remove('open');
  });

  clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Delete all cached translations? This cannot be undone.')) return;
    try {
      await TranslationCache.clear();
      renderEntries(tableContainer, clearAllBtn);
    } catch (err) {
      console.error('Clear all failed:', err);
    }
  });

  tableContainer.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const cacheKey = btn.getAttribute('data-key');

    if (btn.classList.contains('btn-preview')) {
      await showPreview(cacheKey, overlay);
    } else if (btn.classList.contains('btn-delete')) {
      await deleteEntry(cacheKey, btn.closest('tr'), tableContainer, clearAllBtn);
    }
  });

  await renderEntries(tableContainer, clearAllBtn);
});

async function showPreview(cacheKey, overlay) {
  const entries = await TranslationCache.list();
  const entry = entries.find(e => e.cacheKey === cacheKey);
  if (!entry) return;

  document.getElementById('previewTitle').textContent = entry.title || 'Unknown page';
  document.getElementById('previewBody').innerHTML = buildPreviewContent(entry);
  overlay.classList.add('open');
}

async function deleteEntry(cacheKey, row, container, clearAllBtn) {
  if (!cacheKey) return;

  try {
    await TranslationCache.remove(cacheKey);
  } catch (err) {
    console.error('Delete failed:', err);
    return;
  }

  row.remove();

  const tbody = container.querySelector('tbody');
  if (!tbody || tbody.children.length === 0) {
    container.innerHTML = '<div class="empty-state">No cached translations yet</div>';
    clearAllBtn.style.display = 'none';
  }
}

function renderEntries(container, clearAllBtn) {
  return TranslationCache.list()
    .then(entries => {
      if (!entries || entries.length === 0) {
        container.innerHTML = '<div class="empty-state">No cached translations yet</div>';
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        return;
      }

      if (clearAllBtn) clearAllBtn.style.display = '';

      const table = document.createElement('table');
      table.className = 'history-table';

      table.innerHTML = `
        <thead>
          <tr>
            <th>Page</th>
            <th>Target</th>
            <th>Date</th>
            <th>Blocks</th>
            <th></th>
          </tr>
        </thead>
      `;

      const tbody = document.createElement('tbody');

      entries.forEach(entry => {
        const tr = document.createElement('tr');

        const title = entry.title || 'Unknown page';
        const url = entry.url || '';
        const langName = getLanguageName(entry.targetLanguage);

        tr.innerHTML = `
          <td>
            ${url ? `<a class="cell-title" href="${escapeHTML(url)}" target="_blank" rel="noopener" title="${escapeHTML(url)}">${escapeHTML(title)}</a>` : `<span class="cell-title">${escapeHTML(title)}</span>`}
          </td>
          <td class="cell-lang"><span class="lang-badge">&rarr; ${escapeHTML(langName)}</span></td>
          <td class="cell-date">${formatRelativeTime(entry.createdAt)}</td>
          <td class="cell-blocks">${entry.totalBlocks || 0}</td>
          <td class="cell-action">
            <button class="btn-preview btn-secondary" data-key="${escapeHTML(entry.cacheKey)}">Preview</button>
            <button class="btn-delete btn-danger" data-key="${escapeHTML(entry.cacheKey)}">Delete</button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.innerHTML = '';
      container.appendChild(table);
    })
    .catch(err => {
      container.innerHTML = '<div class="empty-state">Failed to load translation history</div>';
      console.error('History load error:', err);
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLanguageName(code) {
  const map = {
    spanish: 'Spanish',
    french: 'French',
    german: 'German',
    chinese: 'Chinese (S)',
    'chinese-traditional': 'Chinese (T)',
    japanese: 'Japanese',
    korean: 'Korean',
    portuguese: 'Portuguese',
    italian: 'Italian',
    russian: 'Russian',
    arabic: 'Arabic',
    hindi: 'Hindi',
    dutch: 'Dutch',
    swedish: 'Swedish',
    norwegian: 'Norwegian',
  };
  return map[code] || code;
}

function buildPreviewContent(entry) {
  const blocks = entry.blocks || [];
  if (blocks.length === 0) return '<p class="preview-empty">No content available</p>';

  const parts = [];
  for (const block of blocks) {
    const items = (block.items || [])
      .map(item => (Array.isArray(item) ? item.join(' ') : String(item ?? '')))
      .filter(text => text.trim().length > 0);

    if (items.length === 0) continue;

    parts.push(
      '<div class="preview-block">' +
        items.map(text => `<p class="preview-item">${escapeHTML(text)}</p>`).join('') +
        '</div>'
    );
  }

  return parts.length > 0 ? parts.join('') : '<p class="preview-empty">No content available</p>';
}

function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function escapeHTML(str) {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
