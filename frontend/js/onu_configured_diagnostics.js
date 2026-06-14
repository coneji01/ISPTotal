
function initListItemsSelects(value_name) {
	var selectedValues;

	if (form_data[value_name] !== '' && typeof(form_data[value_name])=='string') {
		selectedValues = form_data[value_name].split(',');
	
		selectedValues.forEach(function (val) {
			$('.' + value_name + '-filter[value="' + val + '"]').addClass('active');
		});
	}
}

function removeEmpty(obj) {
	var returnObj={};

	Object.keys(obj).forEach(function(key) {
	  if (Array.isArray(obj[key]) && obj[key].length>0) {
		  returnObj[key] = obj[key];
	  } else if (obj[key] != '') {
		  returnObj[key] = obj[key];
	  }
	});

	return returnObj;
}

var _pendingConfiguredCall = null;
var _pendingConfiguredKey = null;

function getConfigured(form_data, getUrl, containerSelector) {
	//if there are more than 5 olts, then the vlan filter is disabled if no olt is selected
	if($('#olts_count').val() > 5 && form_data['olt_id'] == "") {
		form_data['vlan_id'] = "";
		form_data['vlan'] = [];

		// Canonicalize the URL softly (no page reload). updateUrlParameters() does a
		// full window.location.replace() when the URL doesn't already match form_data
		// (e.g. landing on the bare URL without the default sort params), which would
		// reload the page and fire get_configured_list a second time.
		if (window.history.replaceState) {
			var canonicalUrl = getUrlWithFormDataParams(form_data);
			if (canonicalUrl) {
				window.history.replaceState({}, null, canonicalUrl);
			}
		} else {
			updateUrlParameters(form_data);
		}
	}

	var requestKey = getUrl + '|' + JSON.stringify(removeEmpty(form_data));

	// A single filter change can fire from more than one handler (e.g. clearing the
	// OLT fires both the multiselect onChange and the SVLAN/CVLAN reset). If an
	// identical request is already in flight, let it finish instead of issuing a
	// second identical request.
	if (_pendingConfiguredCall && _pendingConfiguredKey === requestKey) {
		return;
	}

	// A request with different params supersedes the pending one.
	if (_pendingConfiguredCall) {
		_pendingConfiguredCall.abort();
		_pendingConfiguredCall = null;
		_pendingConfiguredKey = null;
	}

	$(containerSelector).children().css('opacity', '0.3');
	var x = window.innerWidth / 2 - 40;
	var y = $(window).scrollTop() + window.innerHeight / 2;

	$(containerSelector).prepend("<div id='configure_loading' class='text-center' style='position: absolute; left: " + x + "px; top: " + y + "px;'><i class='fa fa-5x fa-spinner fa-spin text-blue'></i></div>");

	var configuredAjaxCall = $.ajax({
		type: 'GET',
		url: getUrl,
		timeout: 60000,
		data: removeEmpty(form_data),
		success: function(data)
		{
			_pendingConfiguredCall = null;
			_pendingConfiguredKey = null;
			$(containerSelector).html(data);
			if (containerSelector === '#onu_configured_list' && typeof syncBatchOnuSelectionUi === 'function') {
				syncBatchOnuSelectionUi();
			}
		},
		error: function(jqXHR, textStatus) {
			if (textStatus === 'abort') return;
			_pendingConfiguredCall = null;
			_pendingConfiguredKey = null;
			$('#configure_loading').remove();
			$(containerSelector).children().css('opacity', '1');
		}
	});

	_pendingConfiguredCall = configuredAjaxCall;
	_pendingConfiguredKey = requestKey;
	registerJqxhr(configuredAjaxCall);
}

var _refreshConfiguredTimer = null;
function refreshConfiguredData() {
	// A single user action can fire several triggers in the same tick (e.g. clearing
	// the OLT fires both the multiselect onChange and the SVLAN/CVLAN reset, which
	// mutate form_data at different points). Coalesce them into one request that runs
	// after form_data has settled, so the list is fetched exactly once with final params.
	if (_refreshConfiguredTimer) {
		clearTimeout(_refreshConfiguredTimer);
	}
	_refreshConfiguredTimer = setTimeout(function() {
		_refreshConfiguredTimer = null;
		getConfigured(form_data, '/onu/get_configured_list','#onu_configured_list');
	}, 0);
}

function refreshDiagnosticsData() {
	getConfigured(form_data, '/diagnostics/get_diagnostics_list', '#diagnostics_list');
}

function initFilterActions() {	

	$(".status-filter").on('click', function() {
		$(this).siblings().removeClass('active');
		$(this).addClass('active');
		$("#status").val($(this).attr('value'));
		
		form_data['status'] = $(this).attr('value');

		$(".configured").submit();
	});

	$(".signal-filter").on('click', function() {
		$(this).siblings().removeClass('active');
		$(this).addClass('active');
		$("#signal").val($(this).attr('value'));
		
		form_data['signal'] = $(this).attr('value');

		$(".configured").submit();
	});

	$(".input-search").focus(function() {
		$(this).data('old-value', $(this).val());
	});
	
	$(".input-search").blur(function() {
		if($(this).data('old-value') != $(this).val()) {
			$(".configured").submit();
		}
	});

	$(".input-search").keypress(function(evt) {
		var charCode = (evt.which) ? evt.which : evt.keyCode;
		//on enter key filter results
	    if(charCode == 13) {
	    	$(this).data('old-value', $(this).val());
	    	
	    	$(".configured").submit();
	    }
	});
}

function set_update_needed_to_false(select_name) {
	update_needed[select_name] = false;
}

function add_to_list(list, value) {
	var values=list.split(',');

	values.push(value);
	return values.join(',');
}

function del_from_list(list, value) {
	var values=list.split(',');
	var index = values.indexOf(value);

	if (index !== -1) {
		values.splice(index,1);
	}

	return values.join(',');
}


function handle_button_filters($element, isCtrlPressed, name) {
	if ($element.hasClass('active')) {
		$element.removeClass('active');
		
		if (isCtrlPressed) {
			form_data[name] = del_from_list(form_data[name], $element.attr('value'));
		} else {
			form_data[name] = '';
			$element.siblings().removeClass('active');
		}
	} else {
		$element.addClass('active');

		if (isCtrlPressed) {
			form_data[name] = add_to_list(form_data[name], $element.attr('value'));
		} else {
			form_data[name] = $element.attr('value');
			$element.siblings().removeClass('active');
		}
	}
}

function initFilterActionsNoSubmit(submit_function, getUrl, selector, onChangeCallback) {	

	$(".pon_type-filter").on('click', function(event) {
		handle_button_filters($(this), event.ctrlKey, 'pon_type');

		refreshUrlParameters(form_data, onChangeCallback);
	});

	$(".status-filter").on('click', function(event) {
		handle_button_filters($(this), event.ctrlKey, 'status');

		refreshUrlParameters(form_data, onChangeCallback);
	});

	$(".signal-filter").on('click', function(event) {
		handle_button_filters($(this), event.ctrlKey, 'signal');

		refreshUrlParameters(form_data, onChangeCallback);
	});

	$(".onu_mode-filter").on('click', function(event) {
		handle_button_filters($(this), event.ctrlKey, 'onu_mode');

		refreshUrlParameters(form_data, onChangeCallback);
	});

	$(".select-search").on('change', function() {
		var filter_name = $(this).attr("name");
		form_data[filter_name] = $(this).val();

		for (var [name, value] of Object.entries(update_needed)) {
			if (name !== filter_name && !value) {
				update_needed[name] = true;
			}
		}
	});
	
	$(".input-search").on('focus', function() {
		$(this).data('old-value', $(this).val());
	});
	
	$(".input-search").on('blur', function() {
		if($(this).data('old-value') != $(this).val()) {
			form_data[$(this).attr("name")] = $(this).val();
			
			refreshUrlParameters(form_data, onChangeCallback);
		}
	});
	
	$(".input-search").on('keypress', function(event) {
		//on enter key filter results
		if(event.key == 'Enter') {
			event.preventDefault();
			
			$(this).data('old-value', $(this).val());
			
			form_data[$(this).attr("name")] = $(this).val();
			
			refreshUrlParameters(form_data, onChangeCallback);
		}
	});
}

var timeoutStopOnuStatus = [];
var timeoutGetOnuStatus = [];
function getOnuStatus(onuId, url, viewOnuUrl) {
	
	var AjaxCall = $.ajax({
		type: "GET",
		beforeSend: function(request) {
		    request.setRequestHeader("X-Token", config.X_TOKEN);
		  },
		url: url,
		success: function(data)
		{
			stopGetOnuStatus(onuId);

			if (data.status === true)
			{
				var status_html = "-";
				var signal_html = "-";

				if(data.onu_status_available === true)
				{
					if(data.onu_status !== "-") 
					{
						if(data.onu_status == "Online") { 
							status_html = "<a href='" + viewOnuUrl + "'><i class='fa fa-globe fa-md text-green'></i></a>";
						} else if(data.onu_status == "Power fail") {
							status_html = "<a href='" + viewOnuUrl + "'><i class='fa fa-plug fa-md text-grey'></i></a>";
						} else if(data.onu_status == "LOS") { 
							status_html = "<a href='" + viewOnuUrl + "'><i class='fa fa-chain-broken fa-md text-grey'></i></a>";
						} else if(data.onu_status == "Offline") { 
							status_html = "<a href='" + viewOnuUrl + "'><i class='fa fa-globe fa-md text-grey'></i></a>";
						} 

						if(data.onu_signal == "Very good") { 
							signal_html = "<i class='fa fa-signal fa-md text-green\'></i>";
						} 
						else if(data.onu_signal == "Warning") { 
							signal_html = "<i class='fa fa-signal fa-md' style='color:darkorange;'></i>";
						} 
						else if(data.onu_signal == "Critical") { 
							signal_html = "<i class='fa fa-signal fa-md' style='color:red;'></i>";
						}
					}					 				 
					
				}
				else
				{
					// SmartOLTPolling pauses while the tab is hidden and
					// fires immediately on resume; fall back to plain setTimeout
					// if the helper isn't on the page.
					if (typeof window.SmartOLTPolling !== 'undefined') {
						timeoutGetOnuStatus[onuId] = window.SmartOLTPolling.scheduleOnce(function () {
							getOnuStatus(onuId, url, viewOnuUrl);
						}, 10000);
					} else {
						timeoutGetOnuStatus[onuId] = setTimeout(function () {
							getOnuStatus(onuId, url, viewOnuUrl);
						}, 10000);
					}
				}

				$("#status_onu_" + onuId).html(status_html);
				$("#signal_onu_" + onuId).html(signal_html);
			}
		}
	});

	registerJqxhr(AjaxCall);
}

function stopGetOnuStatus(onuId) {
	var t = timeoutGetOnuStatus[onuId];
	if (!t) return;
	if (typeof t.clear === 'function') {
		t.clear();
	} else {
		clearTimeout(t);
	}
}
