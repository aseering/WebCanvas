
function add_p(a, b) { return { 'x': a.x + b.x, 'y': a.y + b.y }; }
function sub_p(a, b) { return { 'x': a.x - b.x, 'y': a.y - b.y }; }
function div_pc(a, c) { return { 'x': a.x / c, 'y': a.y / c }; }

function bezier_pts(P, tension) {
  var B = [P[1], null, null, P[2]];
  B[1] = add_p(P[1], div_pc(sub_p(P[2], P[0]), tension));
  B[2] = sub_p(P[2], div_pc(sub_p(P[3], P[1]), tension));
  return B;
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

jQuery(document).ready(function(){
    var canvas = $('#canvas').get(0);
    var ctxt = canvas.getContext("2d");
    ctxt.fillStyle = "black";
    ctxt.beginPath();

    var point_queues = {};

    var point_counter = 0;
    
    var count;
    var mousedown = false;
    var curr_user_id = null;
    
    function draw_pt(user_id, pt) {
	if (point_queues[user_id] == null) {
	    point_queues[user_id] = PointDrawQueue(ctxt);
	}
	point_queues[user_id].addPoint(pt);
    }
    
    function handleMouseCoord(evt, obj) {
	if (mousedown) {
	    var data = {'x': evt.pageX - obj.offsetLeft,
			'y': evt.pageY - obj.offsetLeft };
	    socket.emit('mousemove_send',data);
	    draw_pt(curr_user_id, data);
	}
    }
    
    var socket = io.connect("/");

    function occasionally_flush_path() {
	point_counter++;
	if (point_counter > 100) {
	    ctxt.closePath();
	    ctxt.beginPath();
	    point_counter = 0;
	}
    }
    
    socket.on('mousemove_recv', function(user_id, data) { 
	if (user_id == curr_user_id) { return; } 
	draw_pt(user_id, data);
	occasionally_flush_path();
    });
    
    socket.on('mouseup_recv', function(user_id) {
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
	ctxt.clearRect(0, 0, canvas.width, canvas.height);
	ctxt.closePath();
	ctxt.beginPath();
    });
    
    socket.on('send_pagedata', function(data) {
	var ops = {
	    'mousemove_recv': function(user_id, data) {
		draw_pt(user_id, data);		
		occasionally_flush_path();
	    },
	    'mouseup_recv': function(user_id) {
		if (!point_queues[user_id]) { return; }
		point_queues[user_id].flush();
		point_queues[user_id] = null;
		ctxt.closePath();
		ctxt.beginPath();
	    }
	};

	var val, fn;
	for (var x = 0; x < data.length; x++) {
	    val = data[x];
	    try {
		fn = ops[val['op']];
		fn.apply(fn, val['args']);
	    } catch (err) { console.log(err); }
	}
    });

    // Go fetch our user ID
    socket.emit('get_pagedata');
    socket.emit('get_userid');
    
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
	socket.emit('mouseup_send');
	mousedown = false;
	ctxt.closePath();
	ctxt.beginPath();
    });

    $('#clear_btn').click(function(evt) {
	socket.emit('clear');
    });
});
