// export_manager.js
var ExportManager = function(options) {
  this.options = options || {};
  this.createExport = function(data) {
    if (this.options.onStart) this.options.onStart();
    var self = this;
    setTimeout(function() {
      if (self.options.onComplete) self.options.onComplete({ download_url: '#' });
    }, 500);
  };
};
