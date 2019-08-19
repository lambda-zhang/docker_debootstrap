Meteor.publish('get-messages', function(type, to){
  if (!this.userId)
    return;
  
  console.log('======get-messages======', this.userId);
  var slef = this;
  var user = Meteor.users.findOne(slef.userId);
  var where = null;

  if(type === 'group')
    where = {'to.id': to, to_type: type}; // 没有判断是否在群的处理。自动加群
  else
    where = {
      $or: [
        {'form.id': slef.userId, 'to.id': to, to_type: type}, // me -> ta
        {'form.id': to, 'to.id': slef.userId, to_type: type}  // ta -> me
      ]
    };

  switch(type){
    case 'user':
      return [
        Meteor.users.find({_id: to}),
        // Messages.find(where, {limit: limit || 20, sort: {create_time: -1}})
      ];
    case 'group':
      var group = Groups.findOne({_id: to});
      var groupName = null;
      if(group){
        groupName = group.name;
      }
      Meteor.call('create-group', to, groupName, [slef.userId]);
      return [
        Groups.find({_id: to}, {limit: 1}),
        // Messages.find(where, {limit: limit || 20, sort: {create_time: -1}})
      ];
  }
});

Meteor.publish('get-messages-new', function(type, to){
  if (!this.userId)
    return;
  
  console.log('======get-messages-new======', this.userId);
  var slef = this;
  var user = Meteor.users.findOne(slef.userId);
  var where = null;

  if(type === 'group')
    where = {'to.id': to, to_type: type}; // 没有判断是否在群的处理。自动加群
  else
    where = {
      $or: [
        {'form.id': slef.userId, 'to.id': to, to_type: type}, // me -> ta
        {'form.id': to, 'to.id': slef.userId, to_type: type}  // ta -> me
      ]
    };

  switch(type){
    case 'user':
      return [
        Meteor.users.find({_id: to}),
        // Messages.find(where, {limit: limit || 20, sort: {create_time: -1}})
      ];
    case 'group':
      var group = Groups.findOne({_id: to});
      var groupName = null;
      if(group){
        groupName = group.name;
      }
      // Meteor.call('create-group', to, groupName, [slef.userId]);
      return [
        Groups.find({_id: to}, {limit: 1}),
        // Messages.find(where, {limit: limit || 20, sort: {create_time: -1}})
      ];
  }
});

Meteor.publish('get-msg-session', function(limit){
  if (!this.userId)
    return this.ready();
  var limit = limit || 60;

  var slef = this;
  var groupHandle = [];

  var fixGroupName = function(fields){
    if (fields.sessionType === 'group' && fields.toUserId){
      var group = Groups.findOne({_id: fields.toUserId});
      if (group && group.name){fields.toUserName = group.name}
      if (group && group.icon){fields.toUserIcon = group.icon}

      // 临时性的自动将群名称是"群聊 XXX"的故事群修正为"XXX 的故事群"
      if (group && group.name && group.is_post_group && group._id.endsWith('_group') && group.name.startsWith('群聊 ')){
        var id = group._id.replace('_group', '');
        var user = Meteor.users.findOne({_id: id});
        if (user){
          var username = user.profile && user.profile.fullname ? user.profile.fullname : user.username;
          console.log('username='+username);
          fields.toUserName = username + ' 的故事群';
          Groups.update({_id: group._id}, {$set: {name: fields.toUserName}});
          console.log('修正群名称:', group._id);
        }
      }
    }
  };

  var where = {
    $or: [
      {userId: this.userId}, // 自己的
      {app_user_id: this.userId}  // 关联的web账户的
    ]
  };

  var handle = MsgSession.find(where, {limit: limit, sort: {updateAt: -1}}).observeChanges({
    added: function(id, fields){
      fixGroupName(fields);
      // console.log('message session add', fields);
      slef.added('simple_chat_msg_session', id, fields);
    },
    changed: function(id, fields){
      fixGroupName(fields);
      // console.log('message session changed', fields);
      slef.changed('simple_chat_msg_session', id, fields);
    },
    removed: function(id){
      // console.log('message session remove', id);
      slef.removed('simple_chat_msg_session', id);
    }
  });
  this.ready();
  this.onStop(function(){
    handle && handle.stop();
  });

  //return MsgSession.find({userId: this.userId}, {limit: 60});
});

Meteor.publish('get-group', function(id){
  return Groups.find({_id: id});
});

Meteor.publish('get-chat-message', function(toid){
  return ChatMessage.find({'to.id': toid}, {fields:{_id: 1}}, {sort: {createAt: -1}, limit: 200});
});

Meteor.publish('get-chat-message-by-id', function(id){
  return ChatMessage.find({'_id': id});
});

// Meteor.publish('get-user-group',function(userId){
//   return GroupUsers.find({user_id: userId});
// });

Meteor.publish('get-group-user', function(id){
  return GroupUsers.find({group_id: id});
});

Meteor.publish('get-group-user-with-limit', function(id,limit){
  return GroupUsers.find({group_id: id},{limit:limit});
});

Meteor.publish("group-user-counter",function(id){
  Counts.publish(this, 'groupsUserCountBy-'+id, GroupUsers.find({group_id: id}), {reactive: true });
});

Meteor.publish('get-my-group', function(user_id){
  //console.log('pub get-my-group', GroupUsers.find({user_id: user_id}).count());
  return GroupUsers.find({user_id: user_id});
});

Meteor.publish('get-label-names', function(limit){
  limit = limit || 20;
  return PersonNames.find({}, {sort: {createAt: 1}, limit: limit});
});
