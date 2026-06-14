// common.js - Funciones comunes ISPTotal
window.form_data = {};
var update_needed = {};

function overwriteFormDataFromUrlParameters() {
  var params = new URLSearchParams(window.location.search);
  params.forEach(function(value, key) { form_data[key] = value; });
}

function refreshUrlParameters(data, callback) {
  if (typeof window[callback] === 'function') window[callback]();
}

function initFilterActionsNoSubmit(action) {
  $('.get-unconfigured, .refresh-single-olt').on('click', function() {
    if (typeof window[action] === 'function') window[action]();
  });
}

function initOltUnconfigured() { console.log('initOltUnconfigured ready'); }

function initListItemsSelects(name) {
  $('.' + name + '-filter').on('click', function() {
    form_data[name] = $(this).attr('value') || '';
  });
}

var SmartOLTPolling = {
  register: function(callback, ms) {
    var timer = setInterval(callback, ms);
    return { stop: function() { clearInterval(timer); } };
  }
};

function showSelectOltMessage() {
  $('#gpon_epon_unconfigured').html('<div class="text-center text-muted" style="padding:40px"><i class="fa fa-info-circle fa-2x"></i><p>Please select an OLT</p></div>');
}

function dynamicSelectLoad() { console.log('dynamicSelectLoad'); }

window.escapeHtml = function(text) {
  if (!text) return '';
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};
