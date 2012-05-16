var app = require('express').createServer(),
io = require('socket.io').listen(app, {log: false}),
fs = require('fs'),
redis = require('redis'),
db = redis.createClient();

app.listen(8081);

var user_id = 0;

app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
});

app.get('/pad/:id', function(req, res) {
    res.sendfile(__dirname + '/canvas.html');
});

app.get('/jquery.ui.touch.js', function (req, res) {
    res.sendfile(__dirname + '/jquery.ui.touch.js');
});

app.get('/canvas_client.js', function (req, res) {
    res.sendfile(__dirname + '/canvas_client.js');
});

function Set(id_fn) {
    var set = {}

    return {
	'add': function(elt) {
	    var key = id_fn(elt);
	    if (!set[key]) {
		set[key] = elt;
	    }
	},

	'contains': function(elt) {
	    return set[ id_fn(elt) ] && true || false;
	},

	'remove': function(elt) {
	    var key = id_fn(elt);
	    if (set[key]) {
		delete set[key];
	    }
	},

	'apply': function(fn) {
	    for (var elt in set) {
		fn(set[elt]);
	    }
	}
    };
}

function RoomQueue() {
    var rooms = {};

    return {
	'subscribe': function(socket, room) {
	    if (!rooms[room]) {
		rooms[room] = Set(function (socket) { return socket.id; })
	    }
	    rooms[room].add(socket);
	},

	'unsubscribe': function(socket, room) {
	    if (rooms[room] && rooms[room].contains(socket)) {
		rooms[room].remove(socket);
		if (Object.keys(rooms[room]).length == 0) {
		    delete rooms[room];
		}
	    }
	},

	'emit': function(room, args) {
	    if (rooms[room]) {
		rooms[room].apply(function (sock) {
		    sock.emit.apply(sock, args);
		});
	    }
	}   
    };
}

var roomQueue = RoomQueue();

io.sockets.on('connection', function(socket) {
    var this_user_id = user_id++,
        this_notename = "";

    socket.on('set_notepad', function(notename) {
	if (this_notename) {
	    roomQueue.unsubscribe(socket, this_notename);
	}
	this_notename = notename;
	roomQueue.subscribe(socket, this_notename);
    });

    socket.on('set_userid', function(user_id) {
	this_user_id = user_id;
    });

    socket.on('get_userid', function(data) {
	socket.emit('send_userid', this_user_id);
    });

    socket.on('get_pagedata', function() {
	var success = db.lrange(this_notename, 0, -1, function (err, reply) {
	    socket.emit('send_pagedata', reply);
	});
    });

    socket.on('clear', function() {
	db.ltrim(this_notename, 0, 0);
	roomQueue.emit(this_notename, ['send_clear']);
    });

    socket.on('mousemove_send', function(data) {
	roomQueue.emit(this_notename, ['mousemove_recv', this_user_id, data]);
	db.lpush(this_notename, JSON.stringify(['m', this_user_id, data]));
    });

    socket.on('mouseup_send', function(data) {
        roomQueue.emit(this_notename, ['mouseup_recv', this_user_id]);
	db.lpush(this_notename, JSON.stringify(['u', this_user_id]));
    });
});
