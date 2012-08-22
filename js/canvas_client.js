

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

// Create the Canvas namespace/object
var cnv = {};

cnv.constructors = {};

// Global constants
cnv.constants = {
    RAW_CANVAS_WIDTH: 850,
    RAW_CANVAS_HEIGHT: 1100,
    TOOLBAR_HEIGHT: 30
};

cnv.constructors.io = function() {
    this.socket = io.connect("/");
    this.sender = BatchPointSender(this.socket);
    this.page_data = null;
    this.mousedown = false;
};
cnv.io = new cnv.constructors.io();

// Canvas manager
cnv.constructors.canvas = function() {
    this.rotated_width = cnv.constants.RAW_CANVAS_WIDTH;
    this.rotated_height = cnv.constants.RAW_CANVAS_HEIGHT;
    this.curr_scale = 1.0;
    this.curr_rot = 0;

    this.rotate_impl = function(pt, width, height, rot) {
	// Take a point in some space
	// and transform it onto the rotated canvas
	if (rot == 0) {
	    return pt;
	} else if (rot == 1) {
	    return {x: pt.y, y: width-pt.x};
	} else if (rot == 2) {
	    return {x: width-pt.x, y: height-pt.y};
	} else if (rot == 3) {
	    return {x: height-pt.y, y: pt.x};
	} else {
	    throw "PAD: Bad rotation position!  You've hit a bug!";
	}
    };

    this.rotate_raw = function(pt) {
	// Rotate a point in the RAW_CANVAS space
	return this.rotate_impl(pt, 
				cnv.constants.RAW_CANVAS_WIDTH,
				cnv.constants.RAW_CANVAS_HEIGHT,
				this.curr_rot);
    };
    this.rotate_pt = function(pt) {
	// Rotate a point in the RAW_CANVAS space
	return this.rotate_impl(pt, 
				this.rotated_width,
				this.rotated_height,
				(4-this.curr_rot)%4);
    };

    this.setCanvasDefaults = function() {
	this.ctxt.strokeStyle = 'blue';
	this.ctxt.lineWidth = 1;
	this.ctxt.lineCap = "round";
	this.ctxt.lineJoin = "round";
	this.ctxt.shadowBlur = 3;
	this.ctxt.shadowColor = 'blue';
	this.ctxt.beginPath();
    };

    this.redraw = function(from_server_async) {
	if (from_server_async) {
	    cnv.io.socket.emit('get_pagedata');
	} else {
	    cnv.io.socket.emit('get_pagedata');
	    //throw "TODO: Not Implemented!";
	}
    }

    // Keep the canvas sized to the screen
    this.resize_canvas = function() {
	var toolbar_height = cnv.constants.TOOLBAR_HEIGHT;
	
	var raw_width = this.rotated_width;
	var raw_height = this.rotated_height;
	
	var docOffset = $('body').offset();
	
	var window_width = window.innerWidth - docOffset.left*2;
	var window_height = window.innerHeight - toolbar_height - docOffset.top*2;
	
	var width_ratio = window_width/raw_width;
	var height_ratio = window_height/raw_height;
	
	var ratio = Math.min(width_ratio, height_ratio);
	
	var new_width = raw_width * ratio;
	var new_height = raw_height * ratio;

	var new_size = { width: new_width, height: new_height };

	$('#canvas').attr(new_size);
	$('#toolbar').width(new_width);

	cnv.canvas.ctxt.scale(ratio, ratio);

	// Re-scale/rotate the canvas
	var rot_origin = this.rotate_raw({x: 0, y: 0});
	rot_origin = div_pc(rot_origin, 1);
	this.ctxt.translate(rot_origin.x, rot_origin.y);

	var rot_angle = Math.PI / 2 * -this.curr_rot;
	this.ctxt.rotate(rot_angle);
	
	return ratio;
    }

    this.rotate_frame = function(new_rot) {
	// Resize the canvas
	var new_canvas_size = {x: cnv.constants.RAW_CANVAS_WIDTH,
			       y: cnv.constants.RAW_CANVAS_HEIGHT};
	if (new_rot == 1 || new_rot == 3) {
	    new_canvas_size = {x: new_canvas_size.y,
			       y: new_canvas_size.x};
	}
	this.rotated_width = new_canvas_size.x;
	this.rotated_height = new_canvas_size.y;

	// Assign the new rotation angle
	this.curr_rot = new_rot;

	// And apply a rotation (requires re-scaling)
	this.curr_scale = cnv.canvas.resize_canvas();

	// And, redraw the canvas too
	this.setCanvasDefaults();
	this.redraw(true /* TODO */);
    }
    this.clearCanvas = function() {
	cnv.canvas.ctxt.closePath();
	cnv.canvas.ctxt.beginPath();
	// Just clobber everything.  Don't bother with elegance.
	var size = Math.max(cnv.canvas.canvas.width, cnv.canvas.canvas.height) / cnv.canvas.curr_scale + 1;
	cnv.canvas.ctxt.clearRect(0, 0, size, size);
    }

    this.redraw_from_server = function() {
	// If we're still missing data, don't redraw yet
	if (!cnv.bkgd_img.bkgdImgReady || !cnv.io.page_data) { return; }

	// Draw background image first
	//bkgdImg.width = canvas.width;
	//bkgdImg.height = canvas.height;
//	if (bkgdImgReady) {
	    // Default to the PNG if we have both
	if (cnv.bkgd_img.bkgdImgAvailable) {
	    cnv.canvas.ctxt.drawImage(cnv.bkgd_img.bkgdImg, 0, 0, cnv.canvas.canvas.width, cnv.canvas.canvas.height);
	}
	cnv.canvas.redraw_page();
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
    this.redraw_page = function() {
	// Then draw page contents
	var ops = {
	    'm': function(user_id, data) {
		for (var i = 0; i < data.length; i++) {
		    cnv.draw.draw_pt(user_id, data[i]);		
		    cnv.draw.occasionally_flush_path();
		}
	    },
	    'u': function(user_id) {
		if (!cnv.draw.point_queues[user_id]) { return; }
		cnv.draw.point_queues[user_id].flush();
		cnv.draw.point_queues[user_id] = null;
		cnv.canvas.ctxt.closePath();
		cnv.canvas.ctxt.beginPath();
	    }
	};

	var val, fn;
	// In reverse order, 'cause the server sez so
	for (var x = cnv.io.page_data.length - 1; x >= 0; x--) {
	    val = $.parseJSON(cnv.io.page_data[x]);
//	    try {
		fn = ops[val[0]];
		fn.apply(fn, val.slice(1, val.length));
//	    } catch (err) { console.log(err); }
	}

	if (cnv.multipage && cnv.multipage.onredrawfinished) cnv.multipage.onredrawfinished();
    }

    // Initialization logic
    $(document).ready(function() {
	cnv.canvas.canvas = $('#canvas').get(0);
	cnv.canvas.ctxt = cnv.canvas.canvas.getContext("2d");

	cnv.canvas.ctxt.save();
	cnv.canvas.setCanvasDefaults();
	cnv.canvas.curr_scale = cnv.canvas.resize_canvas();
    });
};
cnv.canvas = new cnv.constructors.canvas();


cnv.constructors.tmp = function() {
    // Variables / state
    this.scratch_space = $('<div></div>').hide();

    // Initialization
    var scratch_space = this.scratch_space;
    $(document).ready(function() { $('body').append(scratch_space); } );
}
cnv.tmp = new cnv.constructors.tmp();

cnv.constructors.pdf = function() {
    // Variables / state
    this.pdf_doc = null;

    var parent_this = this;  // scoping hack?

    // Stuff this before document.ready.  TODO: Is this ok?
    // Disable workers; feature not fully functional for now
    PDFJS.disableWorker = true;
    try {
	PDFJS.getDocument("/img/" + notepad_padname + ".pdf").then(function(_pdfDoc) {
	    parent_this.pdf_doc = _pdfDoc;
	    redraw(true /* TODO */);
	});
    } catch (exc) { console.log(exc); }
};
//cnv.pdf = new cnv.constructors.pdf();


cnv.constructors.notepad = function() {
    // Variables / state
    this.notepad_pagenum = null;

    // Computed state
    if (window.location.hash != "") {
	this.notepad_name = window.location.hash.substring(1);
	this.fast_switching_enabled = true;
	this.notepad_root_path = "";
    } else if (window.location.pathname.substring(0,5) == "/pad/") {
	this.notepad_name = window.location.pathname.substring(5);
	this.fast_switching_enabled = false;
	this.notepad_root_path = "/pad/";
    } else {
	this.notepad_name = window.location.pathname;
	this.fast_switching_enabled = false;
	this.notepad_root_path = "";
    }

    // Go set up our initial state
    cnv.io.socket.emit('set_notepad', this.notepad_name);
};
cnv.notepad = new cnv.constructors.notepad();

cnv.constructors.bkgd_img = function() {
    // Variables / state
    this.bkgdImg = new Image();
    this.bkgdImgReady = false;
    this.bkgdImgAvailable = false;

    this.findDocumentSpan = function(padname, pagenum, cont) {
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

    var parent_this = this;  // scoping hack
    // Initialization logic
    this.bkgdImg.onload = function() {
	parent_this.bkgdImgReady = true;
	parent_this.bkgdImgAvailable = true;
	cnv.canvas.setCanvas();
	cnv.canvas.redraw();
    }
    this.bkgdImg.onerror = function() {
	parent_this.bkgdImgReady = true;
	parent_this.bkgdImgAvailable = false;
	cnv.canvas.setCanvasDefaults();
	cnv.canvas.redraw();
    }

    // Stuff this before document.ready.  TODO: Is this ok?
    // Dependency on cnv.notepad's constructor
    this.bkgdImg.src = "/img/" + cnv.notepad.notepad_name + ".png";
};
cnv.bkgd_img = new cnv.constructors.bkgd_img();


cnv.util = {
    prefetchImg: function(url) {
	var i = new Image();
	i.src = url;
    },
};

cnv.constructors.draw = function() {
    var parent_this = this; // scoping hack

    // Variables / state
    this.point_queues = {};
    this.point_counter = 0;
    this.curr_user_id = null;

    this.draw_pt = function(user_id, pt) {
	if (parent_this.point_queues[user_id] == null) {
	    parent_this.point_queues[user_id] = PointDrawQueue(cnv.canvas.ctxt);
	}
	parent_this.point_queues[user_id].addPoint(pt);
    };

    this.handleMouseCoord = function(evt, obj) {
	if (cnv.io.mousedown) {
	    var data = {'x': (evt.pageX - obj.offsetLeft),
			'y': (evt.pageY - obj.offsetLeft) };
	    data = div_pc(data, cnv.canvas.curr_scale);
	    data = cnv.canvas.rotate_pt(data);

	    cnv.io.sender.sendPt(data);
	    parent_this.draw_pt(parent_this.curr_user_id, data);
	}
    };

    this.occasionally_flush_path = function() {
	this.point_counter++;
	if (this.point_counter > 100) {
	    cnv.canvas.ctxt.closePath();
	    cnv.canvas.ctxt.beginPath();
	    this.point_counter = 0;
	}
    };

    // Handlers
    cnv.io.sender.setRecvPtHandler(function(user_id, data) {
	if (user_id == cnv.draw.curr_user_id) { return; } 
	cnv.draw.draw_pt(user_id, data);
	cnv.draw.occasionally_flush_path();
    });

    cnv.io.sender.setMouseUpHandler(function(user_id) {
	if (user_id == cnv.draw.curr_user_id) { return; }
	if (!cnv.draw.point_queues[user_id]) { return; }
	cnv.draw.point_queues[user_id].flush();
	cnv.draw.point_queues[user_id] = null;
	cnv.canvas.ctxt.closePath();
	cnv.canvas.ctxt.beginPath();
    });

    cnv.io.socket.on('send_userid', function (user_id) {
	cnv.draw.curr_user_id = user_id;
    });
    
    cnv.io.socket.on('send_clear', function (user_id) {
	cnv.canvas.ctxt.closePath();
	cnv.canvas.ctxt.beginPath();
	cnv.canvas.ctxt.clearRect(0, 0, canvas.width/cnv.canvas.curr_scale, canvas.height/cnv.canvas.curr_scale);
	cnv.io.page_data = [];
	cnv.canvas.redraw();
    });
    
    cnv.io.socket.on('send_pagedata', function(data) {
	cnv.io.page_data = data;
	cnv.canvas.redraw_from_server();
    });

    $(window).resize(function() { curr_scale = cnv.canvas.resize_canvas(); cnv.canvas.setCanvasDefaults(); cnv.canvas.redraw(true /* TODO */); });

    $(document).ready(function() {
	$('#canvas').mousedown(function(evt) {
	    cnv.io.socket.emit('mousedown_send');
	    cnv.io.mousedown = true;
	    cnv.draw.handleMouseCoord(evt, this);
	});
    
	$('#canvas').mousemove(function(evt) {
	    cnv.draw.handleMouseCoord(evt, this);
	    cnv.draw.occasionally_flush_path();
	});
	
	$('#canvas').mouseup(function(evt) {
	    cnv.draw.handleMouseCoord(evt, this);
	    cnv.draw.point_queues[cnv.draw.curr_user_id].flush();
	    cnv.draw.point_queues[cnv.draw.curr_user_id] = null;
	    cnv.io.sender.sendMouseUp();
	    cnv.io.mousedown = false;
	    cnv.canvas.ctxt.closePath();
	    cnv.canvas.ctxt.beginPath();
	});
	
	$('#clear_btn').click(function(evt) {
	    cnv.canvas.clearCanvas();
	    cnv.io.socket.emit('clear');
	});
	$('#rotate_left_btn').click(function(evt) { cnv.canvas.rotate_frame( (cnv.canvas.curr_rot + 1)%4 ); } );
	$('#rotate_right_btn').click(function(evt) { cnv.canvas.rotate_frame( (cnv.canvas.curr_rot + 3)%4 ); } );

	// The initial (re-)draw of the canvas
	cnv.canvas.redraw(true);

    });

    // Initialization
    cnv.io.socket.emit('get_userid');
};
cnv.draw = new cnv.constructors.draw();

cnv.constructors.multipage = function() {
    // Variables / state
    this.next_page_uri = null;
    this.prev_page_uri = null;

    this.jumpPage = function(new_pagenum) {
	cnv.notepad.notepad_pagenum = new_pagenum;
	this.next_page_uri = cnv.notepad.notepad_root_path + cnv.notepad.notepad_padname + "-" + (cnv.notepad.notepad_pagenum+1);
	this.prev_page_uri = cnv.notepad.notepad_root_path + cnv.notepad.notepad_padname + "-" + (cnv.notepad.notepad_pagenum-1);
	var next = cnv.notepad.notepad_root_path + cnv.notepad.notepad_padname + "-" + (cnv.notepad.notepad_pagenum);
	cnv.bkgd_img.bkgdImgReady = false;
	cnv.io.page_data = null;
	cnv.canvas.clearCanvas();
	cnv.io.socket.emit('set_notepad', next);
	cnv.bkgd_img.bkgdImg.src = "/img/" + next + ".png";
	cnv.util.prefetchImg("/img/" + cnv.notepad.prev_page_uri + ".png");
	cnv.util.prefetchImg("/img/" + cnv.notepad.next_page_uri + ".png");
	cnv.io.socket.emit('get_pagedata');
	window.location.hash = next;
    }

    // Compute some more initial state
    var notepad_pagesep = cnv.notepad.notepad_name.lastIndexOf('-');
    if (notepad_pagesep != -1) {
	cnv.notepad.notepad_pagenum = parseInt( cnv.notepad.notepad_name.slice( notepad_pagesep+1 ) );
	cnv.notepad.notepad_padname = cnv.notepad.notepad_name.slice(0, notepad_pagesep);
	this.next_page_uri = cnv.notepad.notepad_root_path + cnv.notepad.notepad_padname + "-" + (cnv.notepad.notepad_pagenum+1);
	this.prev_page_uri = cnv.notepad.notepad_root_path + cnv.notepad.notepad_padname + "-" + (cnv.notepad.notepad_pagenum-1);
    }

    $(document).ready(function() {
	$('.next_prev').show();
	$('#prev_pg').click(function(evt) {
	    if (cnv.notepad.notepad_pagenum > 0) {
		if (cnv.notepad.fast_switching_enabled) {
		    cnv.multipage.jumpPage(cnv.notepad.notepad_pagenum-1);
		} else {
		    window.location.pathname = prev_page_uri;
		}
	    }
	});
	$('#next_pg').click(function(evt) {
	    if (cnv.notepad.fast_switching_enabled) {
		cnv.multipage.jumpPage(cnv.notepad.notepad_pagenum+1);
	    } else {
		window.location.pathname = next_page_uri;
	    }
	});

    });
};
cnv.multipage = new cnv.constructors.multipage();

cnv.constructors.downloader = function() {
    // Variables / state
    this.onredrawfinished = null;

    // Handlers
    $(document).ready(function() {
	$('#dl_img').click(function(evt) {
	    document.location.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
	    //$('<iframe></iframe>').src = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"); 
	});
	
	$('#dl_all').click(function(evt) {
	    if (!confirm("Are you sure you want to download the whole document?  It could get EXCITING!")) { return; }
	    cnv.bkgd_img.findDocumentSpan(cnv.notepad.notepad_padname, cnv.notepad.notepad_pagenum, function(first_pg, last_pg) {
		var curr_pg = first_pg;
		cnv.multipage.onredrawfinished = function() {
		    if (curr_pg > last_pg) { 
			cnv.multipage.onredrawfinished = null; 
			cnv.multipage.jumpPage(first_pg);
		    } else {
			var tmp_iframe = $('<iframe></iframe>');
			cnv.tmp.scratch_space.append(tmp_iframe);
			tmp_iframe.attr('onload', function(evt) { setTimeout(60000, $(this).remove); });
			tmp_iframe.attr('src', canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"));
			cnv.multipage.jumpPage(++curr_pg);
		    }
		};
		cnv.multipage.jumpPage(curr_pg);
	    });
	});
    });
};
cnv.downloader = new cnv.constructors.downloader();

