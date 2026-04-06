/**
 * Form observer — watches for conditionally loaded form fields.
 * Uses MutationObserver to detect new fields appearing after user
 * interactions (e.g., AngularJS ng-if, React conditional renders).
 *
 * Follows the same install-once / read-drain pattern as interceptor.js.
 * Depends on form-state.js being injected first.
 */
function lobsterInstallFormObserver() {
  if (window.__lobster_form_observer__) return;

  var store = {
    baselineHashes: null,
    changes: [],
    observer: null,
    debounceTimer: null,
  };
  window.__lobster_form_observer__ = store;

  function computeFieldHashes(formState) {
    var hashes = new Set();
    var fields = [];
    for (var i = 0; i < formState.forms.length; i++) {
      for (var j = 0; j < formState.forms[i].fields.length; j++) {
        fields.push(formState.forms[i].fields[j]);
      }
    }
    for (var k = 0; k < formState.orphanFields.length; k++) {
      fields.push(formState.orphanFields[k]);
    }
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      hashes.add(field.tag + ':' + field.type + ':' + field.name + ':' + field.label);
    }
    return hashes;
  }

  function getFieldsForHashes(formState, hashes) {
    var result = [];
    var allFields = [];
    for (var i = 0; i < formState.forms.length; i++) {
      for (var j = 0; j < formState.forms[i].fields.length; j++) {
        allFields.push(formState.forms[i].fields[j]);
      }
    }
    for (var k = 0; k < formState.orphanFields.length; k++) {
      allFields.push(formState.orphanFields[k]);
    }
    for (var f = 0; f < allFields.length; f++) {
      var field = allFields[f];
      var hash = field.tag + ':' + field.type + ':' + field.name + ':' + field.label;
      if (hashes.has(hash)) result.push(field);
    }
    return result;
  }

  // Compute baseline from current DOM
  var baseline = lobsterFormState();
  store.baselineHashes = computeFieldHashes(baseline);

  function onMutation() {
    clearTimeout(store.debounceTimer);
    store.debounceTimer = setTimeout(function () {
      try {
        var current = lobsterFormState();
        var currentHashes = computeFieldHashes(current);

        // Find new fields (in current but not in baseline)
        var newHashes = new Set();
        currentHashes.forEach(function (h) {
          if (!store.baselineHashes.has(h)) newHashes.add(h);
        });

        // Count removed fields (in baseline but not in current)
        var removedCount = 0;
        store.baselineHashes.forEach(function (h) {
          if (!currentHashes.has(h)) removedCount++;
        });

        if (newHashes.size > 0 || removedCount > 0) {
          store.changes.push({
            timestamp: Date.now(),
            newFields: getFieldsForHashes(current, newHashes),
            removedCount: removedCount,
            totalForms: current.forms.length,
            totalOrphans: current.orphanFields.length,
            fullState: current,
          });
          // Update baseline to latest state
          store.baselineHashes = currentHashes;
        }
      } catch (e) { /* page context may be torn down */ }
    }, 300);
  }

  store.observer = new MutationObserver(onMutation);
  store.observer.observe(document.body, { childList: true, subtree: true });
}

function lobsterGetFormChanges() {
  var store = window.__lobster_form_observer__;
  if (!store) return [];
  var result = store.changes.slice();
  store.changes = [];
  return result;
}

function lobsterDisconnectFormObserver() {
  var store = window.__lobster_form_observer__;
  if (!store) return;
  if (store.observer) store.observer.disconnect();
  clearTimeout(store.debounceTimer);
  delete window.__lobster_form_observer__;
}
