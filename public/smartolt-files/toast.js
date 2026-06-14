let toastTimeout=0;
let toastMsgs = [];

function toast(text) {
    if (!toastMsgs.includes(text)) {
        let toastsBox = $('#toastsBox');

        if(!toastsBox.length) {
            $("#content-wrapper").append("<div id='toastsBox'></div>");
            toastsBox = $('#toastsBox');
        }
        
        toastMsgs.push(text);

        let toast = $('<div>'+text+'</div>').prependTo(toastsBox).addClass('show');

        toastsBox.children().animate({ top:"+=75px"},500);

        setTimeout(function(){ 
            toastMsgs.shift();
            dismissToast(toast);
        }, 6000);
    }
}

function dismissToast(toast) {
    if (toast instanceof jQuery){
        toast.animate({ right: "-100%" , opacity:0 }, 1000, function() { toast.remove(); });
    }
}

$(document).ready(function() {

    $("#content-wrapper").on('click', '#toastsBox > div', function () {
        dismissToast($(this));
    });
});
