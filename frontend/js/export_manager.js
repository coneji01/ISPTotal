/**
 * Export Manager - Handles background export tasks with progress tracking
 *
 * Usage:
 * const exportManager = new ExportManager({
 *   onProgress: (data) => console.log(`Progress: ${data.progress}%`),
 *   onComplete: (data) => window.location.href = data.download_url,
 *   onError: (error) => $.MessageBox(error)
 * });
 *
 * exportManager.createExport({
 *   olt_id: 123,
 *   board: "1",
 *   port: "5",
 *   zone_id: 45
 * });
 */

class ExportManager {
    constructor(options = {}) {
        this.options = {
            apiBaseUrl: options.apiBaseUrl || '/api/export',
            pollInterval: options.pollInterval || 2000, // 2 seconds
            onProgress: options.onProgress || this._defaultProgressHandler.bind(this),
            onComplete: options.onComplete || this._defaultCompleteHandler.bind(this),
            onError: options.onError || this._defaultErrorHandler.bind(this),
            onStart: options.onStart || null,
            xToken: options.xToken || (typeof config !== 'undefined' ? config.X_TOKEN : null)
        };

        this.currentTaskId = null;
        this.pollTimer = null;
        this.isPolling = false;
        this.lastProgress = 0;
        this.stuckAtProgressCount = 0;
        this.simulatedProgress = 0;
    }

    /**
     * Create a new export task
     * @param {Object} filters - Export filters (olt_id, board, port, zone_id, etc.)
     * @returns {Promise}
     */
    async createExport(filters = {}) {
        try {
            // Clean up any existing poll
            this.stopPolling();

            // Call onStart callback
            if (this.options.onStart) {
                this.options.onStart();
            }

            // Create FormData from filters
            const formData = new FormData();
            for (const key in filters) {
                if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
                    formData.append(key, filters[key]);
                }
            }

            // Make API request
            const response = await this._makeRequest('POST', '/create', formData);

            if (response.task_id) {
                this.currentTaskId = response.task_id;
                this.startPolling();
                return response;
            } else {
                throw new Error(response.error || 'Failed to create export task');
            }
        } catch (error) {
            this.options.onError(error.message || error);
            throw error;
        }
    }

    /**
     * Start polling for export status
     */
    startPolling() {
        if (!this.currentTaskId || this.isPolling) {
            return;
        }

        this.isPolling = true;
        this._pollStatus();
    }

    /**
     * Stop polling for export status
     */
    stopPolling() {
        if (this.pollTimer) {
            if (typeof this.pollTimer.clear === 'function') {
                this.pollTimer.clear();
            } else {
                clearTimeout(this.pollTimer);
            }
            this.pollTimer = null;
        }
        this.isPolling = false;
    }

    /**
     * Simulate progress during query building phase
     * @param {Object} tracking - Progress tracking object with lastProgress, stuckCount, simulatedProgress
     * @param {number} currentProgress - Current real progress from backend
     * @param {string} status - Current task status
     * @returns {Object} Object with displayProgress and updated tracking state
     * @private
     */
    _simulateProgress(tracking, currentProgress, status) {
        var displayProgress = currentProgress;
        var usingSimulation = false;

        if (status === 'processing') {
            // Only simulate if stuck at low progress during query building phase
            if (currentProgress === tracking.lastProgress && currentProgress <= 10) {
                tracking.stuckCount++;

                // If stuck at 10% for more than 2 polls (4+ seconds), start simulating progress
                if (tracking.stuckCount > 2 && tracking.simulatedProgress < 80) {
                    // Slowly increment simulated progress (max 80%)
                    tracking.simulatedProgress = Math.min(80, currentProgress + (tracking.stuckCount * 0.5));
                    displayProgress = Math.floor(tracking.simulatedProgress);
                    usingSimulation = true;
                }
            }

            // If we were simulating but now have real progress
            if (!usingSimulation && tracking.simulatedProgress > 0 && currentProgress > 10) {
                // Use the maximum of real progress and simulated progress to avoid going backwards
                displayProgress = Math.max(currentProgress, Math.floor(tracking.simulatedProgress));

                // Stop simulation
                tracking.stuckCount = 0;
                tracking.simulatedProgress = 0;
            }

            // Update lastProgress if progress actually changed
            if (currentProgress > tracking.lastProgress) {
                tracking.lastProgress = currentProgress;
            }
        }

        return {
            displayProgress: displayProgress,
            simulated: usingSimulation
        };
    }

    /**
     * Poll for export status
     * @private
     */
    async _pollStatus() {
        if (!this.isPolling || !this.currentTaskId) {
            return;
        }

        try {
            const data = await this.getStatus(this.currentTaskId);

            // Simulate progress during query building phase
            const tracking = {
                lastProgress: this.lastProgress,
                stuckCount: this.stuckAtProgressCount,
                simulatedProgress: this.simulatedProgress
            };

            const result = this._simulateProgress(tracking, data.progress, data.status);

            // Update instance variables
            this.lastProgress = tracking.lastProgress;
            this.stuckAtProgressCount = tracking.stuckCount;
            this.simulatedProgress = tracking.simulatedProgress;

            // Use simulated or real progress
            data.progress = result.displayProgress;
            if (result.simulated) {
                data.simulated = true;
            }

            // Call progress callback
            this.options.onProgress(data);

            // Check status
            if (data.status === 'completed') {
                this.stopPolling();
                this.options.onComplete(data);
            } else if (data.status === 'failed') {
                this.stopPolling();
                this.options.onError(data.error_message || 'Export failed');
            } else if (data.status === 'processing' || data.status === 'pending') {
                // Continue polling. SmartOLTPolling pauses while the tab is
                // hidden and fires immediately on resume; fall back to plain
                // setTimeout if the helper isn't on the page.
                if (typeof window.SmartOLTPolling !== 'undefined') {
                    this.pollTimer = window.SmartOLTPolling.scheduleOnce(() => this._pollStatus(), this.options.pollInterval);
                } else {
                    this.pollTimer = setTimeout(() => this._pollStatus(), this.options.pollInterval);
                }
            }
        } catch (error) {
            this.stopPolling();
            this.options.onError(error.message || error);
        }
    }

    /**
     * Get export status
     * @param {number} taskId - Task ID
     * @returns {Promise}
     */
    async getStatus(taskId) {
        return this._makeRequest('GET', `/status/${taskId}`);
    }

    /**
     * Cancel export task
     * @param {number} taskId - Task ID (optional, uses current task if not provided)
     * @returns {Promise}
     */
    async cancelExport(taskId = null) {
        const id = taskId || this.currentTaskId;
        if (!id) {
            throw new Error('No task ID provided');
        }

        this.stopPolling();
        return this._makeRequest('POST', `/cancel/${id}`);
    }

    /**
     * Get list of export tasks
     * @param {Object} params - Query parameters (limit, offset, status)
     * @returns {Promise}
     */
    async listExports(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `/list?${queryString}` : '/list';
        return this._makeRequest('GET', url);
    }

    /**
     * Delete export task
     * @param {number} taskId - Task ID
     * @returns {Promise}
     */
    async deleteExport(taskId) {
        return this._makeRequest('DELETE', `/delete/${taskId}`);
    }

    /**
     * Make API request
     * @private
     */
    async _makeRequest(method, endpoint, data = null) {
        const url = this.options.apiBaseUrl + endpoint;

        const options = {
            method: method,
            headers: {}
        };

        // Add X-Token header if available
        if (this.options.xToken) {
            options.headers['X-Token'] = this.options.xToken;
        }

        // Add body for POST/PUT/PATCH
        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            if (data instanceof FormData) {
                options.body = data;
                // Don't set Content-Type for FormData - browser will set it with boundary
            } else {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(data);
            }
        }

        const response = await fetch(url, options);
        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.error || responseData.message || `Request failed with status ${response.status}`);
        }

        return responseData;
    }

    /**
     * Default progress handler
     * @private
     */
    _defaultProgressHandler(data) {
        console.log(`Export progress: ${data.progress}% (${data.processed_onus}/${data.total_onus} ONUs)`);
    }

    /**
     * Default complete handler
     * @private
     */
    _defaultCompleteHandler(data) {
        console.log('Export completed:', data.file_name);
        if (data.download_url) {
            window.open(data.download_url, '_self');
        }
    }

    /**
     * Default error handler
     * @private
     */
    _defaultErrorHandler(error) {
        console.error('Export error:', error);
        alert('Export failed: ' + error);
    }

    /**
     * Get download URL for a task
     * @param {number} taskId - Task ID
     * @returns {string}
     */
    getDownloadUrl(taskId) {
        return this.options.apiBaseUrl + `/download/${taskId}`;
    }
}

/**
 * jQuery plugin wrapper for ExportManager
 * Provides a simple jQuery-style interface for backwards compatibility
 *
 * Usage:
 * $('#export-btn').exportManager({
 *   filters: {
 *     olt_id: $('#olt_id').val(),
 *     board: $('#board').val()
 *   },
 *   progressElement: '#progress-bar',
 *   progressTextElement: '#progress-text',
 *   onComplete: function(data) {
 *     window.open(data.download_url, '_self');
 *   }
 * });
 */
if (typeof jQuery !== 'undefined') {
    (function($) {
        $.fn.exportManager = function(options) {
            return this.each(function() {
                const $button = $(this);
                const settings = $.extend({
                    filters: {},
                    progressElement: null,
                    progressTextElement: null,
                    buttonText: {
                        initial: $button.text(),
                        exporting: 'Exporting...',
                        processing: 'Processing...',
                        complete: 'Export complete!',
                        failed: 'Export failed'
                    },
                    onComplete: null,
                    onError: null
                }, options);

                const manager = new ExportManager({
                    onStart: function() {
                        $button.prop('disabled', true).text(settings.buttonText.exporting);
                        if (settings.progressElement) {
                            $(settings.progressElement).parent().show();
                        }
                    },
                    onProgress: function(data) {
                        $button.text(settings.buttonText.processing + ` ${data.progress}%`);

                        if (settings.progressElement) {
                            $(settings.progressElement)
                                .css('width', data.progress + '%')
                                .attr('aria-valuenow', data.progress);
                        }

                        if (settings.progressTextElement) {
                            $(settings.progressTextElement).text(
                                `${data.processed_onus} / ${data.total_onus} ONUs processed`
                            );
                        }
                    },
                    onComplete: function(data) {
                        $button.text(settings.buttonText.complete);

                        if (settings.progressElement) {
                            $(settings.progressElement).css('width', '100%');
                        }

                        setTimeout(function() {
                            $button.prop('disabled', false).text(settings.buttonText.initial);
                            if (settings.progressElement) {
                                $(settings.progressElement).parent().hide();
                            }
                        }, 2000);

                        if (settings.onComplete) {
                            settings.onComplete(data);
                        } else {
                            window.open(data.download_url, '_self');
                        }
                    },
                    onError: function(error) {
                        $button.text(settings.buttonText.failed);

                        setTimeout(function() {
                            $button.prop('disabled', false).text(settings.buttonText.initial);
                            if (settings.progressElement) {
                                $(settings.progressElement).parent().hide();
                            }
                        }, 2000);

                        if (settings.onError) {
                            settings.onError(error);
                        } else {
                            $.MessageBox(error);
                        }
                    }
                });

                $button.on('click', function(e) {
                    e.preventDefault();

                    // Get filters (can be function or object)
                    const filters = typeof settings.filters === 'function'
                        ? settings.filters()
                        : settings.filters;

                    manager.createExport(filters);
                });
            });
        };
    })(jQuery);
}

// Export for both browser and module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportManager;
}