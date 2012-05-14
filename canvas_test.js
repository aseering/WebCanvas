var app = require('express').createServer(),
io = require('socket.io').listen(app),
fs = require('fs'),
redis = require('redis'),
db = redis.createClient();

app.listen(8081);

var user_id = 0;

app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
  });

app.get('/jquery.ui.touch.js', function (req, res) {
    res.sendfile(__dirname + '/jquery.ui.touch.js');
  });

app.get('/canvas_client.js', function (req, res) {
    res.sendfile(__dirname + '/canvas_client.js');
  });

io.sockets.on('connection', function(socket) {
    var this_user_id = user_id++;

    socket.on('get_userid', function(data) {
	socket.emit('send_userid', this_user_id);
    });

    socket.on('get_pagedata', function() {
	console.log('get_pagedata');
	var success = db.lrange('common_img', 0, -1, function (err, reply) {
	    console.log(reply);
	    var val = [];
	    for (var x = 0; x < reply.length; x++) {
		val.push(JSON.parse(reply[x]));
	    }
	    socket.emit('send_pagedata', val);
	});
    });

    socket.on('clear', function() {
	db.ltrim('common_img', 0, 0);
	io.sockets.emit('send_clear');
    });

    socket.on('mousemove_send', function(data) {
	io.sockets.emit('mousemove_recv', this_user_id, data);
	db.lpush('common_img', JSON.stringify({'op': 'mousemove_recv', 'args': [this_user_id, data]}));
    });

    socket.on('mouseup_send', function(data) {
        io.sockets.emit('mouseup_recv', this_user_id);
	db.lpush('common_img', JSON.stringify({'op': 'mouseup_recv', 'args': [this_user_id]}));
    });
});
