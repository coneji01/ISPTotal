// Shared HTML-escape helper. Renders user-controlled text into HTML safely.
// Escapes & < > " ' so the result is safe in both element-content and
// attribute-value contexts. New call sites should use this rather than rolling
// per-file copies.
function escapeHtml(text) {
	return String(text === null || typeof text === 'undefined' ? '' : text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function initKeyValueList(selectedValue, url, element) {
	var AjaxCall = $.ajax({
		type: 'GET',
		beforeSend: function(request) {
		    request.setRequestHeader("X-Token", config.X_TOKEN);
		  },
		url: url,
		dataType: "json",
		success: function(data)
		{
			var $el = $("#" + element);
            $el.empty(); // remove old options
            var anyText = (typeof LANG !== 'undefined' && LANG.any) ? LANG.any : 'Any';
            $el.append($("<option></option>")
            		.attr("value", "").text(anyText));
            data.response = $.map(data.response, function(el) { return el });
            $.each(data.response, function(key, value) {
                $el.append($("<option></option>")
                		.attr("value", value).text(value));
            });	

			$("#" + element).val(selectedValue);

			if(!selectedValue && selectedValue !== 0) {
				$("#" + element).val($("#" + element + " option:first").val());
			}	
		}, 
		error: function (response, textStatus) {
			if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
				location.reload();
			}
		}
	});

	registerJqxhr(AjaxCall);
}

function dynamicSelectInit($select, onChangeCallback) {

	var buttonContainerClass = $select.attr('class').split(/\s+/).find(function (x) {
		return x.includes('input-');
	});

	var anyText = (typeof LANG !== 'undefined' && LANG.any) ? LANG.any : 'Any';
	var multiselectOptions = {
		enableHTML: true,
		buttonClass: buttonContainerClass,
		nSelectedText: 'sel',
		inheritClass: true,
		enableCaseInsensitiveFiltering: true,
		nonSelectedText: anyText,
		allSelectedText: anyText,
		numberDisplayed: 1,
		buttonContainer:'<div class="btn-group ' + buttonContainerClass + '" />',
		maxHeight: 500,
		templates: {
			button: '<button type="button" class="multiselect dropdown-toggle overflow-hidden " data-toggle="dropdown"><span class="multiselect-selected-text"></span> <b class="caret"></b></button>',
			li: '<li><a tabindex="0" class="col-xs-12"><label class="col-xs-12"></label></a></li>',
		},
		onDropdownShown: function() {
			if (typeof(this.$filter) !== 'undefined') {
				this.$filter.find('.multiselect-search').focus();
			}
		},
		onDropdownHide: function() {
			var span = $(this)[0].$button.children('span');
			var text = span.text();

			if (text.includes('  ')) {
				text = text.substring(0,text.indexOf('  '));
				span.text(text);
			}
		},
		onChange: function(option, checked, select) {
			var text = $(option).text();

			if (text.includes('  ')) {
				text = text.substring(0,text.indexOf('  '));
				$(option).text(text);
			}
			
			if(onChangeCallback) {
				form_data[$(this)[0].$select.attr("name")] = $(this)[0].$select.val().join(',');
				
				refreshUrlParameters(form_data, onChangeCallback);
			}
		}
	}

	$select.attr('multiple', true);

	$select.multiselect(multiselectOptions);

}

function dynamicSelectLoad(element, update, onChangeCallback) {
	var $select = $("#" + element);

	var select_name = $select.attr('name');

	if (typeof($select.attr('undefined')) == 'undefined' && !update) {
		dynamicSelectInit($select, onChangeCallback);
	}

	if (update) {
		var AjaxCall = $.ajax({
				type: 'POST',
				beforeSend: function(request) {
					request.setRequestHeader("X-Token", config.X_TOKEN);
				},
				url: '/api/onu/fetch_distinct_options/' + select_name,
				data: {
					olt_id: form_data.olt_id,
					board: form_data.board,
					port: form_data.port,
					zone_id: form_data.zone_id,
					odb_id: form_data.odb_id,
					vlan: form_data.vlan,
					onu_type_id: form_data.onu_type_id,
					custom_template: form_data.custom_template
				},
				timeout: 10000,
				success: function(data)
				{
					$select.empty(); // remove old options
					$select.multiselect('destroy');	
		
					$.each(data.response, function(key, value) {
						if (typeof value == 'object') {
							$select.append($("<option>").attr("value", value.option_id).html(value.option_name +  
									(typeof(value.nr) !== 'undefined' ? '<span class="badge badge-light pull-right">' + value.nr + '</span>' : '')));
						} else {
							$select.append($("<option>").attr("value", value).text(value));
						}
					});
					
					dynamicSelectInit($select, onChangeCallback);
					
					$select.val(form_data[select_name]);
					$select.multiselect('select', form_data[select_name].split(','));
		
					$select.multiselect('rebuild');	
					
					var selectTextSpan = $select.parent().find('.multiselect-selected-text');
					var text = selectTextSpan.text();

					if (text.includes('  ')) {
						text = text.substring(0,text.indexOf('  '));
						selectTextSpan.text(text);
					}
				}, 
				error: function (response, textStatus) {
					if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
						location.reload();
					}
				}
			});

		registerJqxhr(AjaxCall);
	}
}

function dynamicSelectLoadOdbs(element, update, onChangeCallback) {
	var $select = $("#" + element);

	var select_name = $select.attr('name');

	if (typeof($select.attr('undefined')) == 'undefined' && !update) {
		dynamicSelectInit($select, onChangeCallback);
	}

	if (update) {
		var AjaxCall = $.ajax({
				type: 'POST',
				beforeSend: function(request) {
					request.setRequestHeader("X-Token", config.X_TOKEN);
				},
				url: '/api/system/fetch_distinct_options/' + select_name,
				data: {
					olt_id: form_data.olt_id,
					board: form_data.board,
					port: form_data.port,
					zone_id: form_data.zone_id,
					odb_id: form_data.odb_id,
					vlan: form_data.vlan,
					onu_type_id: form_data.onu_type_id
				},
				timeout: 10000,
				success: function(data)
				{
					$select.empty(); // remove old options
					$select.multiselect('destroy');	
		
					$.each(data.response, function(key, value) {
						if (typeof value == 'object') {
							$select.append($("<option>").attr("value", value.option_id).html(value.option_name +  
									(typeof(value.nr) !== 'undefined' ? '<span class="badge badge-light pull-right">' + value.nr + '</span>' : '')));
						} else {
							$select.append($("<option>").attr("value", value).text(value));
						}
					});
					
					dynamicSelectInit($select, onChangeCallback);
					
					$select.val(form_data[select_name]);
					$select.multiselect('select', form_data[select_name].split(','));
		
					$select.multiselect('rebuild');	
					
					var selectTextSpan = $select.parent().find('.multiselect-selected-text');
					var text = selectTextSpan.text();

					if (text.includes('  ')) {
						text = text.substring(0,text.indexOf('  '));
						selectTextSpan.text(text);
					}
				}, 
				error: function (response, textStatus) {
					if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
						location.reload();
					}
				}
			});

		registerJqxhr(AjaxCall);
	}
}


function initKeyValueOrObjectList(selectedValue, url, element) {

	var AjaxCall = $.ajax({
		type: 'GET',
		beforeSend: function(request) {
		    request.setRequestHeader("X-Token", config.X_TOKEN);
		  },
		url: url,
		timeout: 10000,
		success: function(data)
		{
			var $el = $("#" + element);
            $el.empty(); // remove old options

			$.each(data.response, function(key, value) {
                if (typeof value == 'object') {
        		    $el.append($("<option>").attr("value", value.id).html(value.name +  
						(typeof(value.nr) !== 'undefined' ? '<span class="badge badge-light pull-right">' + value.nr + '</span>' : '')
					));
                } else {
                    $el.append($("<option>").attr("value", value).text(value));
                }
			});

			$el.val(selectedValue);

			$el.attr('multiple', true);

			var buttonContainerClass = $el.attr('class').split(/\s+/).find(function (x) {
				return x.includes('input-');
			});

			var anyText = (typeof LANG !== 'undefined' && LANG.any) ? LANG.any : 'Any';
			var multiselectOptions = {
				enableHTML: true,
				buttonClass: buttonContainerClass,
				nSelectedText: 'sel',
				inheritClass: true,
				enableCaseInsensitiveFiltering: ($el.children().length > 17),
				nonSelectedText: anyText,
				allSelectedText: anyText,
				numberDisplayed: 3,
				buttonContainer:'<div class="btn-group ' + buttonContainerClass + '" />',
				maxHeight: 500,
				templates: {
					button: '<button type="button" class="multiselect dropdown-toggle overflow-hidden" data-toggle="dropdown"><span class="multiselect-selected-text"></span> <b class="caret"></b></button>',
					li: '<li><a tabindex="0" class="col-xs-12"><label class="col-xs-12"></label></a></li>',
				},
				onDropdownShown: function() {
					if (typeof(this.$filter) !== 'undefined') {
						this.$filter.find('.multiselect-search').focus();
					}
				},
			}

			$el.multiselect(multiselectOptions);
		}, 
		error: function (response, textStatus) {
			if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
				location.reload();
			}
		}
	});

	registerJqxhr(AjaxCall);
}

function enableFilteringWithMultiselect(elementId, fullWidth = true) {
	var $el;

	if (elementId.charAt(0) == '#') {
		$el = $(elementId);
	} else {
		$el = $('#' + elementId);
	}

	var multiselectOptions = {
		enableHTML: true,
		buttonClass: '',
		inheritClass: true,
		enableCaseInsensitiveFiltering: true,
		buttonContainer:'<div class="btn-group full-width"/>',
		nonSelectedText: 'Please select',
		numberDisplayed: 1,
		widthSynchronizationMode: 'always',
		buttonTextAlignment: 'left',
		maxHeight: 500,
		templates: {
			button: '<div class="multiselect dropdown-toggle overflow-hidden" data-toggle="dropdown"><span class="multiselect-selected-text"></span> <span class="caret pull-right" aria-hidden="true"></span></div>',
			li: '<li><a href="#" tabindex="0"><label></label></a></li>',
		},
		onChange: function(option, checked) {
			   this.$container.removeClass('open');
		},
		zIndex: 10000
	};

	if (!fullWidth) {
		multiselectOptions.buttonContainer = '<div class="btn-group"/>';
	}

	$el.multiselect(multiselectOptions);
}

function initKeyObjectList(selectedValue, url, element, multiselect = false) {

	if (multiselect) {
		enableFilteringWithMultiselect(element, false);
	}

	var AjaxCall = $.ajax({
		type: 'GET',
		beforeSend: function(request) {
		    request.setRequestHeader("X-Token", config.X_TOKEN);
		  },
		url: url,
		dataType: "json",
		success: function(data)
		{
			var $el = $("#" + element);
            $el.empty(); // remove old options
            var anyText = (typeof LANG !== 'undefined' && LANG.any) ? LANG.any : 'Any';
            $el.append($("<option></option>")
            		.attr("value", "").text(anyText));
            data.response = $.map(data.response, function(el) { return el });

			$.each(data.response, function(key, value) {
				if(element == 'olt_id') {
					$el.append($("<option></option>")
		            		.attr("value", value.id).text(value.id + ' - ' + value.name));
				}
				else {
					$el.append($("<option></option>")
		            		.attr("value", value.id).text(value.name));
				}
			});

			if (typeof(form_data)=='undefined') { // unconfigured or export
				if(!selectedValue) {
					$el.val($("#" + element + " option:first").val());
				} else {
					$el.val(selectedValue);
				}
			} else {
				var element_name = $el.attr('name');

				if (typeof(form_data[element_name])!='undefined' && form_data[element_name]!=='') {
					$el.val(form_data[element_name]);
				} else {
					$el.val(selectedValue);
				}
			}

			if (multiselect) {
				$el.multiselect("rebuild");
			}
		}, 
		error: function (response, textStatus) {
			if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
				location.reload();
			}
		}
	});

	registerJqxhr(AjaxCall);
}

function initKeyObjectListWithGroups(selectedValue, url, element, field_name, group_field, group_id, anyOption = true, noneOption = false) {
	var AjaxCall = $.ajax({
		type: 'GET',
		beforeSend: function(request) {
		    request.setRequestHeader("X-Token", config.X_TOKEN);
		  },
		url: url,
		dataType: "json",
		success: function(data)
		{
			fillKeyObjectListWithGroups(data.response, selectedValue, element, field_name, group_field, group_id, anyOption, noneOption);
		}, 
		error: function (response, textStatus) {
			if (typeof(response.statusText) =='string' && response.statusText=='Forbidden') {
				location.reload();
			}
		}
	});
	
	registerJqxhr(AjaxCall);
}

function fillKeyObjectListWithGroups(listValues, selectedValue, element, field_name, group_field, group_id, anyOption = true, noneOption = false) {
	var $el = $("#" + element);
	var current_group = '';
	var group = null;
    $el.empty(); // remove old options

    var anyText = (typeof LANG !== 'undefined' && LANG.any) ? LANG.any : 'Any';
    if(anyOption) {
    	$el.append($("<option></option>").attr("value", "").text(anyText));
    }
    
    if(noneOption) {
    	$el.append($("<option></option>").attr("value", "none").text("None"));
    }

    listValues = $.map(listValues, function(el) { return el });
    $.each(listValues, function(key, value) {
    	if (typeof value[group_field] !== 'undefined' && current_group !== value[group_field]) {
			if (current_group !== '') {
				$el.append(group);
				group = null;
			}
			current_group = value[group_field];
			group = $("<optgroup>",{ label: current_group });
    	}
    	
    	if (group) {
    		group.append($("<option></option>").attr("value", value.id).attr("data-group-id", value[group_id]).text(value[field_name]));
    	} else {
    		$el.append($("<option></option>").attr("value", value.id).text(value[field_name]));
    	}
    		
    });

    if (group) {
		$el.append(group);
	}

	$("#" + element).val(selectedValue);

	if(!selectedValue) {
		$("#" + element).val($("#" + element + " option:first").val());
	}
}

function containsAlphanumericDashAndDot(event, fieldName, fieldSelector) {
	var pattern = new RegExp("^[a-zA-Z0-9-.]+$");
	if (!$(fieldSelector).val().length || !pattern.test($(fieldSelector).val()))
	{
		$.MessageBox('The ' + fieldName + ' field is required and can contain only alphanumeric characters, dot (.) and the dash (-) character');
		event.preventDefault();
		return false;
	}
	
	return true;
}

function containsAlphanumericUnderscoreDotPlusSlashDash(event, fieldName, fieldSelector) {
	var pattern = new RegExp("^[a-zA-Z0-9_.+/-]+$");
	if (!$(fieldSelector).val().length || !pattern.test($(fieldSelector).val()))
	{
		$.MessageBox('The ' + fieldName + ' field is required and can contain only alphanumeric characters, underscore (_), dot (.), plus (+), slash (/) and the dash (-) character');
		event.preventDefault();
		return false;
	}
	
	return true;
}

function containsNumeric(event, fieldName, fieldSelector, isRequired = true) {
	var pattern = new RegExp("^[0-9]*$");
	if ((isRequired && !$(fieldSelector).val().length) || !pattern.test($(fieldSelector).val()))
	{
		$.MessageBox('The ' + fieldName + ' field is required and can contain only numbers');
		event.preventDefault();
		return false;
	}
	
	return true;
}

function input_text_validation_failes(id, check_if_empty = false) {
	var input = $('#' + id);
	var value = input.val();
	var pattern = input.attr('pattern');
	var invalidmsg = input.data('invalidmsg');
	
	if ((check_if_empty || value !== '') && pattern != undefined) {
		var regex = new RegExp(pattern);
		if (!regex.test(value)) {
			$.MessageBox( invalidmsg ).done(function(data, button) {
				input.focus();
			});
			return true;
		}
	}
	
	return false;
}

function isMultipleOf(event, fieldName, fieldSelector, multiple) {
	if ($(fieldSelector).val().length && ($(fieldSelector).val() % multiple) !== 0)
	{
		$.MessageBox('The ' + fieldName + ' field must be a multiple of ' + multiple);
		event.preventDefault();
		return false;
	}
	
	return true;
}

function showOverlayAndDisableButton(button) {
	showLoadingOverlay();
	
	$(button).attr('disabled', true).append($('<i class="fa fa-spinner fa-spin margin-left"></i>'));
}

function refreshUrlParameters(form_data, onChangeCallback) {
	var updateUrl = true;
	if(window.history.replaceState) {
		var url = getUrlWithFormDataParams(form_data);

		if (url) {
			updateUrl = false;
			
			if(onChangeCallback) {
				window[onChangeCallback]();
			}
			
			window.history.pushState({}, null, url);
		}
	}
	
	if(updateUrl) {
		updateUrlParameters(form_data);
	}
}

function updateUrlParameters(form_data) {
	if(areUrlParamsTheSameAsFormData()) {
		return;
	}

	// Preserve flash messages across page reload by storing them in sessionStorage
	$('.flash-message').each(function() {
		var type = $(this).hasClass('alert-success') ? 'success' : 'error';
		var message = $(this).html();
		sessionStorage.setItem('flash_' + type, message);
	});

	var url = getUrlWithFormDataParams(form_data);

	if (url) {
		window.location.replace(url);
	}
}

function getUrlWithFormDataParams(form_data) {
	var paramsArray = [];

	if (typeof(form_data) != 'undefined') {
		for (var [optName, optVar] of Object.entries(form_data)) {
			if ( optVar != '' && (optName != 'page' || optVar != '1') ) {
				paramsArray.push(optName+'='+encodeURIComponent(optVar));
			}
		}
	
		var url;
		var paramsDelimiterPos = location.href.indexOf('?');
		
		if (paramsDelimiterPos > 0) {
			url = location.href.slice(0, paramsDelimiterPos);
		} else {
			url = location.href;
		}
	
		return url + '?' + paramsArray.join('&');
	}
	
	return null;
}

function overwriteFormDataFromUrlParameters() {
	if (window.location.search!=="") {
		var params = location.href.slice(location.href.indexOf('?') + 1);
		var optArr = params.split('&');

		var optName, optVal;

		for (var i of optArr) {
			[optName, optVal] = i.split('=');

			if (typeof(optName) != 'undefined' && typeof(optVal)!='undefined' &&  optName in form_data) {
				form_data[optName] = decodeURIComponent(optVal.replace(/\+/g, ' '));

				if ($('[name="' + optName + '"]').attr('multiple') == 'multiple') {
					form_data[optName] = form_data[optName].split(',');
				}
				$('[name="' + optName + '"]').val(form_data[optName]);
			}
		}
	}
}

function areUrlParamsTheSameAsFormData() {
	if (window.location.search !== "" && typeof(form_data) != 'undefined') {
		var params = location.href.slice(location.href.indexOf('?') + 1);
		var optArr = params.split('&');

		var optName, optVal;

		var paramsArray = [];
		for (var i of optArr) {
			[optName, optVal] = i.split('=');
			
			if (typeof(optName) != 'undefined' && typeof(optVal)!='undefined') {
				paramsArray[optName] = decodeURIComponent(optVal.replace(/\+/g, ' '));
			}
		}
		
		for (var [optName, optVar] of Object.entries(form_data)) {
			if((optName in paramsArray) && optVar != paramsArray[optName]) {
				return false;
			}
			
			if(!(optName in paramsArray) && optVar != '' && (optName != 'page' || optVar != '1')) {
				return false;
			}
		}
		
		return true;
	}
	
	return false;
}

function hideOverlayAndEnableButton(button) {
	hideLoadingOverlay();

	$(button).attr('disabled', false).children('i.fa-spinner').remove();

}
