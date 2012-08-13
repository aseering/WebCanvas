

function add_p(a, b) { return { 'x': a.x + b.x, 'y': a.y + b.y }; }
function sub_p(a, b) { return { 'x': a.x - b.x, 'y': a.y - b.y }; }
function div_pc(a, c) { return { 'x': a.x / c, 'y': a.y / c }; }

function bezier_pts(P, tension) {
  var B = [P[1], null, null, P[2]];
  B[1] = add_p(P[1], div_pc(sub_p(P[2], P[0]), tension));
  B[2] = sub_p(P[2], div_pc(sub_p(P[3], P[1]), tension));
  return B;
}

function dataUrlToBinary(url) {
    var regex = new RegExp("^data:image/([A-Za-z0-9]*);base64,(.*)$");
    var data = regex.exec(url);
    if (data) {
	return {'type': data[1], 'data': atob(data[2])};
    } else {
	return null;
    }
}

function BatchPointSender(socket) {
    var queue = [],
        DELAY = 100,
        timer = null;

    return {
	'sendPt': function(pt) {
	    queue.push(pt);
	    if (!timer) {
		timer = setTimeout(function() {
		    socket.emit('mousemove_send', queue);
		    queue = [];
		    timer = null;
		}, DELAY);
	    }
	},

	'sendMouseUp': function() {
	    clearTimeout(timer);
	    socket.emit('mousemove_send', queue);
	    socket.emit('mouseup_send');
	    queue = [];
	    timer = null;
	},
	    
	'setRecvPtHandler': function(recvFn) {
	    socket.on('mousemove_recv', function(user_id, other_q) {
		for (var i = 0; i < other_q.length; i++) {
		    recvFn(user_id, other_q[i]);
		}
	    })
	},

	'setMouseUpHandler': function(upFn) {
	    socket.on('mouseup_recv', upFn);
	}

    };
}

function PointDrawQueue(ctxt) {
  return {
      _points: [],
      _tension: 6.0,
      addPoint: function(pt) {
          var points = this._points;
          // Throw out invalid points silently
          if (pt == null || pt.x == null || pt.y == null) { return; }
	  // Throw out duplicate points
	  if (points.length >= 1 && points[0].x == pt.x && points[0].y == pt.y) { return; }

	  points.unshift(pt);
	  if (points.length > 4) {
	    points.pop();
	  }

	  if (points.length <= 1) {
	    // Nothing we can do
	  } else if (points.length == 2) {
            // If we just have two points, draw a line, to get things moving
	    ctxt.moveTo(points[0].x, points[0].y);
            ctxt.lineTo(points[1].x, points[1].y);
	    ctxt.stroke();
	  } else if (points.length == 3) {
	    // If we have three points, skip a point;
            // we have to accumulate a point to start doing curvingness
	  } else {
	    B = bezier_pts(this._points, this._tension);
	    ctxt.moveTo(B[0].x, B[0].y);
	    ctxt.bezierCurveTo(B[1].x, B[1].y, B[2].x, B[2].y, B[3].x, B[3].y);
	    ctxt.stroke();
	  }
    },
      flush: function() {
        var points = this._points;
        if (points.length > 2) {
	  ctxt.moveTo(points[0].x, points[0].y);
	  ctxt.lineTo(points[1].x, points[1].y);
	  ctxt.stroke();
        } else if (points.length <= 2 && points.length > 0) {
	  ctxt.moveTo(points[0].x, points[0].y);
	  ctxt.arc(points[0].x, points[0].y, 1, Math.PI*2, 0, true);
	  ctxt.stroke();
	}
	this._points = [];
      }
  };
}

// Keep the canvas sized to the screen
function resize_canvas(common_ctxt) {
    var toolbar_height = 30;  // Arbitrary buffer for drawing the toolbar

    var raw_width=850;
    var raw_height=1100;
    
    var docOffset = $('body').offset();
    console.log(docOffset);

    var window_width=window.innerWidth - docOffset.left*2;
    var window_height=window.innerHeight - toolbar_height - docOffset.top*2;
    
    var width_ratio = window_width/raw_width;
    var height_ratio = window_height/raw_height;
    
    var ratio = Math.min(width_ratio, height_ratio);
    
    var new_width = raw_width * ratio;
    var new_height = raw_height * ratio;
    
    $('#canvas').attr({ width: new_width, height: new_height });
    $('#toolbar').width(new_width);
    if (common_ctxt) common_ctxt.scale(ratio, ratio);

    return ratio;
}

function setCanvas(ctxt) {
    ctxt.strokeStyle = 'blue';
    ctxt.lineWidth = 1;
    ctxt.lineCap = "round";
    ctxt.lineJoin = "round";
    ctxt.shadowBlur = 3;
    ctxt.shadowColor = 'blue';
    ctxt.beginPath();
}

jQuery(document).ready(function(){

    var RAW_CANVAS_WIDTH=850;
    var RAW_CANVAS_HEIGHT=1100;

    var curr_scale = 1.0;

    var scratch_space = $('<div></div>').hide();
    $('body').append(scratch_space);

    var canvas = $('#canvas').get(0);
    var ctxt = canvas.getContext("2d");
    ctxt.save();
    curr_scale = resize_canvas(ctxt);
    setCanvas(ctxt);

    // Just in case there's a background image
    var bkgdImg = new Image();
    var bkgdImgReady = false;
    var bkgdImgAvailable = false;
    var pageData = null;

    var pdfDoc = null;

    bkgdImg.onload = function() { bkgdImgReady = true; bkgdImgAvailable = true; redraw(); }
    bkgdImg.onerror = function() { bkgdImgReady = true; bkgdImgAvailable = false; redraw(); }

    var notepad_name;
    var fast_switching_enabled = false;
    var notepad_root_path = "";
    if (window.location.hash != "") {
	notepad_name = window.location.hash.substring(1);
	fast_switching_enabled = true;
	notepad_root_path = "";
    } else if (window.location.pathname.substring(0,5) == "/pad/") {
	notepad_name = window.location.pathname.substring(5);
	notepad_root_path = "/pad/";
    } else {
	notepad_name = window.location.pathname;
    }

    var notepad_pagenum = null;
    var next_page_uri = null;
    var prev_page_uri = null;
    var notepad_pagesep = notepad_name.lastIndexOf('-');
    var notepad_padname = "";
    if (notepad_pagesep != -1) {
	notepad_pagenum = parseInt( notepad_name.slice( notepad_pagesep+1 ) );
	notepad_padname = notepad_name.slice(0, notepad_pagesep);
	next_page_uri = notepad_root_path + notepad_padname + "-" + (notepad_pagenum+1);
	prev_page_uri = notepad_root_path + notepad_padname + "-" + (notepad_pagenum-1);
    }

    bkgdImg.src = "/img/" + notepad_name + ".png";

    // Disable workers; feature not fully functional for now
/*    PDFJS.disableWorker = true;
    try {
	PDFJS.getDocument("/img/" + notepad_padname + ".pdf").then(function(_pdfDoc) {
	    pdfDoc = _pdfDoc;
	    redraw();
	});
    } catch (exc) { console.log(exc); }*/

    var point_queues = {};

    var point_counter = 0;
    
    var count;
    var mousedown = false;
    var curr_user_id = null;
    
    var socket = io.connect("/");

    var sender = BatchPointSender(socket);

    function prefetchImg(url) {
	var i = new Image();
	i.src = url;
    }

    function draw_pt(user_id, pt) {
	if (point_queues[user_id] == null) {
	    point_queues[user_id] = PointDrawQueue(ctxt);
	}
	point_queues[user_id].addPoint(pt);
    }
    
    function handleMouseCoord(evt, obj) {
	if (mousedown) {
	    var data = {'x': (evt.pageX - obj.offsetLeft) / curr_scale,
			'y': (evt.pageY - obj.offsetLeft) / curr_scale };
	    sender.sendPt(data);
	    draw_pt(curr_user_id, data);
	}
    }

    function occasionally_flush_path() {
	point_counter++;
	if (point_counter > 100) {
	    ctxt.closePath();
	    ctxt.beginPath();
	    point_counter = 0;
	}
    }
    
    sender.setRecvPtHandler(function(user_id, data) {
	if (user_id == curr_user_id) { return; } 
	draw_pt(user_id, data);
	occasionally_flush_path();
    });

    sender.setMouseUpHandler(function(user_id) {
	if (user_id == curr_user_id) { return; } 
	if (!point_queues[user_id]) { return; }
	point_queues[user_id].flush();
	point_queues[user_id] = null;
	ctxt.closePath();
	ctxt.beginPath();
    });
    
    socket.on('send_userid', function (user_id) {
	curr_user_id = user_id;
    });
    
    socket.on('send_clear', function (user_id) {
	ctxt.closePath();
	ctxt.beginPath();
	ctxt.clearRect(0, 0, canvas.width/curr_scale, canvas.height/curr_scale);
	pageData = [];
	redraw();
    });
    
    socket.on('send_pagedata', function(data) {
	pageData = data;
	redraw();
    });

    function findDocumentSpan(padname, pagenum, cont) {
	var curr_pagenum = pagenum;
	var first_pagenum = null, last_pagenum = null;

	// This is a slightly ridiculous approach.
	// But we're going to have to do all this fetching anyway.
	// Really hope the browser caches it...
	var probeImg = new Image();

	function mkUrl(name, num) { return "/img/" + name + "-" + num + ".png"; }

	// Read back to the beginning
	probeImg.onload = function(evt) {
	    probeImg.src = mkUrl(padname, --curr_pagenum);
	}
	probeImg.onerror = function(evt) {
	    // We found the beginning.  Now search forward.
	    first_pagenum = curr_pagenum + 1;

	    probeImg.onload = function(evt) {
		probeImg.src = mkUrl(padname, ++curr_pagenum);
	    }
	    probeImg.onerror = function(evt) {
		// Now we have the range of the document.
		// Go do something with that info.
		last_pagenum = curr_pagenum - 1;
		cont(first_pagenum, last_pagenum);
	    }

	    curr_pagenum = pagenum;
	    probeImg.src = mkUrl(padname, ++curr_pagenum);
	}

	probeImg.src = mkUrl(padname, --curr_pagenum);
    }

    function jumpPage(new_pagenum) {
	notepad_pagenum = new_pagenum;
	next_page_uri = notepad_root_path + notepad_padname + "-" + (notepad_pagenum+1);
	prev_page_uri = notepad_root_path + notepad_padname + "-" + (notepad_pagenum-1);
	var next = notepad_root_path + notepad_padname + "-" + (notepad_pagenum);
	bkgdImgReady = false;
	pageData = null;
	clearCanvas(ctxt);
	socket.emit('set_notepad', next);
	bkgdImg.src = "/img/" + next + ".png";
	prefetchImg("/img/" + prev_page_uri + ".png");
	prefetchImg("/img/" + next_page_uri + ".png");
	socket.emit('get_pagedata');
	window.location.hash = next;
    }

    function clearCanvas(ctxt) {
	ctxt.closePath();
	ctxt.beginPath();
	ctxt.clearRect(0, 0, canvas.width, canvas.height);
    }

    function redraw() {
	// If we're still missing data, don't redraw yet
	if (!bkgdImgReady || !pageData) { return; }

	// Draw background image first
	//bkgdImg.width = canvas.width;
	//bkgdImg.height = canvas.height;
//	if (bkgdImgReady) {
	    // Default to the PNG if we have both
	if (bkgdImgAvailable) {
	    ctxt.drawImage(bkgdImg, 0, 0, canvas.width, canvas.height);
	}
	redraw_page();
	    /*	} else {
	    pdfDoc.getPage(notepad_pagenum).then(function(page) {
		ctxt.closePath();
		ctxt.restore();
		page.render({canvasContext: ctxt, viewport: page.getViewport(1.1)}).then(function() {
		    ctxt.save();
		    ctxt.beginPath();
		    setCanvas();
		    redraw_page();
		});
	    });
	}*/
    }
    function redraw_page() {
	// Then draw page contents
	var ops = {
	    'm': function(user_id, data) {
		for (var i = 0; i < data.length; i++) {
		    draw_pt(user_id, data[i]);		
		    occasionally_flush_path();
		}
	    },
	    'u': function(user_id) {
		if (!point_queues[user_id]) { return; }
		point_queues[user_id].flush();
		point_queues[user_id] = null;
		ctxt.closePath();
		ctxt.beginPath();
	    }
	};

	var val, fn;
	// In reverse order, 'cause the server sez so
	for (var x = pageData.length - 1; x >= 0; x--) {
	    val = $.parseJSON(pageData[x]);
	    try {
		fn = ops[val[0]];
		fn.apply(fn, val.slice(1, val.length));
	    } catch (err) { console.log(err); }
	}

	if (onredrawfinished) onredrawfinished();
    }

    var onredrawfinished = null;

    // Go set up our initial state
    socket.emit('set_notepad', notepad_name);
    socket.emit('get_userid');
    socket.emit('get_pagedata');
    
    $('#canvas').mousedown(function(evt) {
	socket.emit('mousedown_send');
	count = 0;
	mousedown = true;
	handleMouseCoord(evt, this);
    });
    
    $('#canvas').mousemove(function(evt) {
	handleMouseCoord(evt, this);
	occasionally_flush_path();
    });
    
    $('#canvas').mouseup(function(evt) {
	handleMouseCoord(evt, this);
	point_queues[curr_user_id].flush();
	point_queues[curr_user_id] = null;
	sender.sendMouseUp();
	mousedown = false;
	ctxt.closePath();
	ctxt.beginPath();
    });

    $('#clear_btn').click(function(evt) {
	clearCanvas(ctxt);
	socket.emit('clear');
    });

    $('#dl_img').click(function(evt) {
	document.location.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
	//$('<iframe></iframe>').src = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"); 
    });

    $('#dl_all').click(function(evt) {
	if (!confirm("Are you sure you want to download the whole document?  It could get EXCITING!")) { return; }
	findDocumentSpan(notepad_padname, notepad_pagenum, function(first_pg, last_pg) {
	    var curr_pg = first_pg;
	    onredrawfinished = function() {
		if (curr_pg > last_pg) { 
		    onredrawfinished = null; 
		    jumpPage(first_pg);
		} else {
		    var tmp_iframe = $('<iframe></iframe>');
		    scratch_space.append(tmp_iframe);
		    tmp_iframe.attr('onload', function(evt) { setTimeout(60000, $(this).remove); });
		    tmp_iframe.attr('src', canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"));
		    jumpPage(++curr_pg);
		}
	    };
	    jumpPage(curr_pg);
	});
    });

    if (notepad_pagenum != null) {  // We have multiple pages; display next/prev
	$('.next_prev').show();
	$('#prev_pg').click(function(evt) {
	    if (notepad_pagenum > 0) {
		if (fast_switching_enabled) {
		    jumpPage(notepad_pagenum-1);
		} else {
		    window.location.pathname = prev_page_uri;
		}
	    }
	});
	$('#next_pg').click(function(evt) {
	    if (fast_switching_enabled) {
		jumpPage(notepad_pagenum+1);
	    } else {
		window.location.pathname = next_page_uri;
	    }
	});
    }

    $(window).resize(function() { curr_scale = resize_canvas(ctxt); setCanvas(ctxt); redraw(); });
});



