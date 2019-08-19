var async = Meteor.npmRequire('async');
var Fiber = Meteor.npmRequire('fibers');

var subscribeMQTT = function(userId, topic, callback){
  var client = mqtt.connect('ws://tmq.tiegushi.com:80', {
    clean: false,
    keepalive: 30,
    reconnectPeriod: 1000,
    clientId: userId
  });

  var timeout = Meteor.setTimeout(function(){
    client_end(new Error('mqtt sub timeout'));
  }, 1000*30);

  var client_end = function(err){
    Fiber(function(){
      try{
        timeout && Meteor.clearTimeout(timeout);
        timeout = null;
        client.end(false, function(){
          client = null;
        });
        // Meteor.setTimeout(function(){
          callback && callback(err);
        // }, 1000*1);
      } catch (e){
        console.log('subscribeMQTT error:', e);
        // callback && callback(e);
      }
    }).run();
  };

  client.on('connect', function(){
    client.subscribe(topic, {qos: 1}, function(err){
      err && console.log('mqtt sub err:', err);
      !err && console.log('mqtt sub succ');
      client_end(err);

      // client.unsubscribe(topic, function(err1){
      //   err1 && console.log('mqtt unsub err:', err1);
      //   console.log('mqtt sub && unsub succ', userId);
      //   client_end(err1);
      // });
    });
  });
  client.on('error', function(err){
    client_end(err);
  });
};

Meteor.startup(function(){
  Meteor.setTimeout(function(){
    console.log('==================');
    async.mapLimit([1], 1, function(user, re_cb){
      Fiber(function(){
        subscribeMQTT('eb07a3d35e3ac2315770bfef', '/t/msg/g/67dd8b026a59fb5ea8436c0c', function(err){
          console.log('=======fsdfdsfdsf====');
          re_cb && re_cb();
        });
      }).run();
    }, function(){
      sendMqttGroupMessage('67dd8b026a59fb5ea8436c0c', {
        form: {
          id: 'AsK6G8FvBn525bgEC',
          name: '故事贴小秘',
          icon: 'http://data.tiegushi.com/AsK6G8FvBn525bgEC_1471329022328.jpg'
        },
        to: {
          id: '67dd8b026a59fb5ea8436c0c',
          name: 'test',
          icon: ''
        },
        type: 'text',
        to_type: 'group',
        text: 'hi',
        is_read: false,
        create_time: new Date()
      });
      console.log('==================');
      console.log('ok');
      console.log('==================');
    });
  }, 1000*10);
});

var sendMQTTMsg = function(users, group, callback){
  if (users.length <= 0)
    return callback && callback(null);

  async.mapLimit(users, 10, function(user, re_cb){
    Fiber(function(){
      sendMqttGroupMessage(group._id, {
        _id: new Mongo.ObjectID()._str,
        form: {
          id: 'AsK6G8FvBn525bgEC',
          name: '故事贴小秘',
          icon: 'http://data.tiegushi.com/AsK6G8FvBn525bgEC_1471329022328.jpg'
        },
        to: {
          id: group._id,
          name: group.name,
          icon: group.icon
        },
        type: 'text',
        to_type: 'group',
        text: (user.profile && user.profile.fullname ? user.profile.fullname : user.username) + ' 加入了聊天室',
        is_read: false,
        create_time: new Date()
      });
      re_cb && re_cb(null);
    }).run();
  }, function(err){
    callback && callback(err);
  });
};

var addGroupUserMsg = function(users, group, callback){
  if (users.length <= 0)
    return callback && callback(null);

  async.mapSeries(users, function(user, re_cb){
    Fiber(function(){
      var msgSession = MsgSession.findOne({userId: user._id, toUserId: group._id, sessionType: 'group'});
      if (!msgSession){
        MsgSession.insert({
          toUserId : group._id,
          toUserName : group.name,
          toUserIcon : group.icon,
          sessionType : "group",
          userId : user._id,
          userName : user.profile && user.profile.fullname ? user.profile.fullname : user.username,
          userIcon : user.profile && user.profile.icon ? user.profile.icon : "/userPicture.png",
          lastText : (user.profile && user.profile.fullname ? user.profile.fullname : user.username) + ' 加入了聊天室',
          updateAt : new Date(),
          createAt : new Date(),
          count : 0
        });
        console.log('生成用户', (user.profile && user.profile.fullname ? user.profile.fullname : user.username), '消息会话');
      }

      subscribeMQTT(user._id, '/t/msg/g/' + group._id, function(error){
        re_cb && re_cb(error);
      });
    }).run();
  }, function(err){
    callback && callback(err);
  });
};

// 创建群（如果不存在）及加群
var upsertGroup = function(id, name, ids, is_post_group, callback){
  id = id || new Mongo.ObjectID()._str;
  ids = ids || [];

  var group = Groups.findOne({_id: id});
  if(group){
    if (group.is_post_group)
      is_post_group = group.is_post_group;

    var $set = {};
    if (!group.name){
      group.name = name;
      $set.name = name;
    }
    if (!group.icon){
      group.icon = 'http://oss.tiegushi.com/groupMessages.png';
      $set.icon = 'http://oss.tiegushi.com/groupMessages.png';
    }
    if (is_post_group && !group.is_post_group){
      group.is_post_group = true;
      $set.is_post_group = true;
    }
    if ($set.name || $set.icon)
      Groups.update({_id: id}, {$set: $set});
  } else {
    group = {
      _id: id,
      name: name,
      icon: 'http://oss.tiegushi.com/groupMessages.png',
      describe: '',
      create_time: new Date(Date.now() + MQTT_TIME_DIFF),
      last_text: '',
      last_time: new Date(Date.now() + MQTT_TIME_DIFF),
      barcode: rest_api_url + '/restapi/workai-group-qrcode?group_id=' + id
    };
    if (is_post_group)
      group.is_post_group = true;
    Groups.insert(group);
  }

  if (!ids || ids.length <= 0)
    return id;

  var newUsers = [];
  for(var i=0;i<ids.length;i++){
    var user = Meteor.users.findOne({_id: ids[i]});
    if (user && GroupUsers.find({group_id: id, user_id: ids[i]}).count() <= 0){
      var groupUser = {
        group_id: group._id,
        group_name: group.name,
        group_icon: group.icon,
        user_id: user._id,
        user_name: user.profile && user.profile.fullname ? user.profile.fullname : user.username,
        user_icon: user.profile && user.profile.icon ? user.profile.icon : '/userPicture.png',
        create_time: new Date(Date.now() + MQTT_TIME_DIFF),
        latest_active_time: new Date(Date.now() + MQTT_TIME_DIFF)
      };
      if (is_post_group)
        groupUser.is_post_group = true;
      GroupUsers.insert(groupUser);
      newUsers.push(user);
      console.log('增加用户', groupUser.user_name, '到群', group.name);
    }
  }

  addGroupUserMsg(newUsers, group, function(err){
    err && console.log('mqtt sub group err:', err);
    !err && console.log('mqtt sub group succ');

    if (err)
      return callback && callback(err);

    sendMQTTMsg(newUsers, group, function(err1){
      callback && callback(err1);
    });
  });

  return id;
};
SimpleChat.upsertGroup = upsertGroup;

Meteor.methods({
  'update_latest_active_time': function(group_id, user_id){
    console.log('update_latest_active_time: group_id='+group_id+', user_id='+user_id);
    GroupUsers.update({
      group_id: group_id,
      user_id: user_id
    },{
      $set: {latest_active_time: new Date()}
    }, function(err, res){
      if(err){
        console.log('update_latest_active_time Err:'+ err);
      } else {
        console.log('update_latest_active_time res = '+ res);
      }
    })
  },
  'upMsgSess': function(doc){
    if (doc.sessionType === 'group'){
      var group = Groups.findOne({_id: doc.toUserId});
      if (group && group.name)
        doc.toUserName = group.name;
      if (group && group.icon)
        doc.toUserIcon = group.icon;
    }

    var msgSession = MsgSession.findOne({userId: doc.userId, toUserId: doc.toUserId});
    if (msgSession){
      delete doc._id;
      return MsgSession.update({_id: msgSession._id}, {$set: doc});
    } else {
      return MsgSession.insert(doc);
    }
  },
  'rmMsgSess': function(doc){
    return MsgSession.remove({userId: doc.userId, toUserId: doc.toUserId});
  },
  'getMsgSess': function(userId, autoStart){
    var limit = autoStart ? 20 : 40;
    if (!autoStart)
      return MsgSession.find({userId: userId}, {sort: {updateAt: -1}, limit: limit}).fetch();
    return MsgSession.find({userId: userId, updateAt: {$lte: autoStart}}, {sort: {updateAt: -1}, limit: limit}).fetch();
  },
  'joinGroup': function(groupId){
    console.log('join group:', this.userId, groupId);
    var group = Groups.findOne({_id: groupId});
    Meteor.call('create-group', groupId, group && group.name ? group.name : null, [this.userId]);
  },
  'create-group': function(id, name, ids){
    this.unblock();
    if (!ids || ids.length <= 0 && this.userId)
      ids = [this.userId];
    if (!ids || ids.length <= 0)
      return id;
    return upsertGroup(id, name, ids);
  },
  'create-group-2': function(id, name, ids){
    this.unblock();
    if (!ids || ids.length <= 0 && this.userId)
      ids = [this.userId];
    if (!ids || ids.length <= 0)
      return id;
    return upsertGroup(id, name, ids, true);
  },
  'add-group-urser':function(id,usersId){
    var slef = this;
    usersId = usersId || [];
    group = Groups.findOne({_id: id});
    if(group){
      if(usersId.indexOf(slef.userId) === -1){
        usersId.splice(0, 0, slef.userId);
      }
      // console.log('ids:', ids);
      var newUsers = [];
      for(var i=0;i<usersId.length;i++){
        var user = Meteor.users.findOne({_id: usersId[i]});
        if(user){
          var isExist = GroupUsers.findOne({group_id: group._id,user_id: user._id});
          if (isExist) {
            console.log('GroupUsers isExist');
            continue;
          }
          // console.log(user);
          var groupUser = {
            group_id: group._id,
            group_name: group.name,
            group_icon: group.icon,
            user_id: user._id,
            user_name: user.profile && user.profile.fullname ? user.profile.fullname : user.username,
            user_icon: user.profile && user.profile.icon ? user.profile.icon : '/userPicture.png',
            create_time: new Date(Date.now() + MQTT_TIME_DIFF),
            latest_active_time: new Date(Date.now() + MQTT_TIME_DIFF)
          };
          if (group.is_post_group)
            groupUser.is_post_group = true;
          GroupUsers.insert(groupUser);

          // var msgSession = MsgSession.findOne({userId: user._id, toUserId: group._id, sessionType: 'group'});
          // if (!msgSession){
          //   MsgSession.insert({
          //     toUserId : group._id,
          //     toUserName : group.name,
          //     toUserIcon : group.icon,
          //     sessionType : "group",
          //     userId : user._id,
          //     userName : user.profile && user.profile.fullname ? user.profile.fullname : user.username,
          //     userIcon : user.profile && user.profile.icon ? user.profile.icon : "/userPicture.png",
          //     lastText : (user.profile && user.profile.fullname ? user.profile.fullname : user.username) + ' 加入了聊天室',
          //     updateAt : new Date(),
          //     createAt : new Date(),
          //     count : 0
          //   });
          //   console.log('生成用户', (user.profile && user.profile.fullname ? user.profile.fullname : user.username), '消息会话');
          // }
          newUsers.push(user);
        }
      }

      if (newUsers.length > 0){
        addGroupUserMsg(newUsers, group, function(err){
          err && console.log('mqtt sub group err:', err);
          !err && console.log('mqtt sub group succ');

          if (err)
            return;

          sendMQTTMsg(newUsers, group, function(err1){
            // TODO:
          });
        });
      }
      return 'succ'
    }
    else{
      return 'not find group';
    }
  },
  'remove-group-user':function(id,userId){
    var groupuser = GroupUsers.findOne({group_id: id,user_id: userId});
    if (groupuser) {
      GroupUsers.remove({_id:groupuser._id},function(err,res){
        if (err) {
          return console.log ('GroupUsers remove failed');
        }
        if (GroupUsers.find({group_id: id}).count === 0){
          Groups.remove({_id:id});
        }

        MsgSession.remove({userId: userId, toUserId: id, sessionType: 'group'});
      });
    }
    return id;
  },
  'remove-group-users-by-id':function(groupId ,id){
    var groupuser = GroupUsers.findOne({_id: id});
    if (groupuser) {
      GroupUsers.remove({_id:id},function(err,res){
        if (err) {
          return console.log ('GroupUsers remove failed');
        }
        if (GroupUsers.find({group_id: groupId}).count === 0){
          Groups.remove({_id:groupId});
        }
        var toUserId = groupId.replace('_group', '')
        MsgSession.remove({userId: groupuser.user_id, toUserId: toUserId, sessionType: 'group'});
      });
    }
    return id;
  }
});
