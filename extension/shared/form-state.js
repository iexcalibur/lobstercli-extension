/**
 * Form state extraction.
 * Ported from LobsterCLI src/browser/dom/form-state.ts
 */
function lobsterFormState() {
  function extractField(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || tag).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return null;

    const name = el.name || el.id || '';
    const label =
      el.getAttribute('aria-label') ||
      (el.id ? document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() : null) ||
      el.closest('label')?.textContent?.trim() ||
      el.placeholder ||
      '';

    let value;
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      value = selected ? selected.textContent.trim() : '';
    } else if (type === 'checkbox' || type === 'radio') {
      value = el.checked;
    } else if (type === 'password') {
      value = el.value ? '****' : '';
    } else if (el.isContentEditable) {
      value = el.textContent?.trim()?.slice(0, 200) || '';
    } else {
      value = el.value || '';
    }

    return { tag, type, name, label: label.slice(0, 80), value: typeof value === 'string' ? value.slice(0, 200) : value, required: !!el.required, disabled: !!el.disabled };
  }

  const result = { forms: [], orphanFields: [] };
  for (const form of document.forms) {
    const fields = [];
    for (const el of form.elements) {
      const field = extractField(el);
      if (field) fields.push(field);
    }
    result.forms.push({ id: form.id || '', name: form.name || '', action: form.action || '', method: (form.method || 'get').toUpperCase(), fields });
  }

  const allInputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
  for (const el of allInputs) {
    if (!el.form) {
      const field = extractField(el);
      if (field) result.orphanFields.push(field);
    }
  }
  return result;
}
