var list_limit_val = 20;
var is_loading = new ReactiveVar(false);
var list_limit = new ReactiveVar(list_limit_val);
var page_title = new ReactiveVar('聊天室');
var list_data = new ReactiveVar([]);
var message_list = new ReactiveVar([]);
var page_data = null;
var timeStyles = new ReactiveVar([]);
var $chat_box = null;
var $simple_chat = null;

// wait 时间内执一次，每 mustRun 至少执行一次，单位毫秒
function throttleClass(wait, mustRun){
  var timeout = null;
  var startTime = null;
  var obj = new Object;

  obj.run = function(func){
    timeout && clearTimeout(timeout);
    if (!startTime)
      startTime = new Date();
    if (new Date() - startTime >= mustRun){
      func();
      startTime = new Date();
    } else {
      timeout = setTimeout(func, wait);
    }
  };
  return obj;
};

Router.route(AppConfig.path + '/to/:type', {
  layoutTemplate: '_simpleChatToChatLayout',
  template: '_simpleChatToChat',
  data: function () {
    var slef = this;
    var to = slef.params.query['id'];
    var type = slef.params.type
    var where = null;
    var name = slef.params.query['name'] ? decodeURIComponent(slef.params.query['name']) : '';
    var icon = slef.params.query['icon'] ? decodeURIComponent(slef.params.query['icon']) : '';

    var sender = Session.get('msgFormUser');
    if (sender && sender.id) {
      console.log('sender.name:'+sender.name);
    }
    else{
      sender = {
        id: Meteor.userId(),
        name: AppConfig.get_user_name(Meteor.user()),
        icon: AppConfig.get_user_icon(Meteor.user())
      }
    }

    if(type === 'group')
      where = {'to.id': to, to_type: type}; // 没有判断是否在群的处理。自动加群
    else
      where = {
        $or: [
          {'form.id': sender.id, 'to.id': to, to_type: type}, // me -> ta
          {'form.id': to, 'to.id': sender.id, to_type: type}  // ta -> me
        ]
      };


    console.log('where:', where);
    return {
      id: slef.params.query['id'],
      name: name,
      icon: icon,
      sender:sender,
      title: function(){
        return name || page_title.get();
      },
      is_group: function(){
        return slef.params.type === 'group';
      },
      query: Messages.find(where, {sort: {create_time: -1}}),
      type: slef.params.type,
      where: where,
      messages: function(){
        // return Messages.find(where, {limit: list_limit.get(), sort: {create_time: -1}}).fetch().reverse();
        return Messages.findArrySortBy_Id(where, {limit: list_limit.get()}, false).reverse();
        // return message_list.get();
      },
      loading: is_loading.get()
    };
  },
  action: function(){
    var self = this;
    $chat_box = null;
    $simple_chat = null;
    hasInputing.set(false);
    hasFooterView.set(false);
    footerView.set('');
    timeStyles.set([]);

    if (this.params.type === 'group')
      Meteor.call('joinGroup', this.params.query['id']);
      //Call from: Router.go(AppConfig.path + '/to/group?id='+_id+'&name='+encodeURIComponent(this.toUserName)+'&icon='+encodeURIComponent(this.toUserIcon));
      console.log('call update_latest_active_time: group_id='+self.params.query['id']+', userId='+Meteor.userId());
      Meteor.call('update_latest_active_time', self.params.query['id'], Meteor.userId())
    this.render();
  }
});

Router.route(AppConfig.path + '/group-list',{
  layoutTemplate: '_simpleChatListLayout',
  template: '_groupMessageList',
  data: function () {
    var lists = []
    return {
      title: '群聊',
      isGroups: true,
      lists: lists
    };
  }
});
Router.route(AppConfig.path + '/user-list/:_user',{
  layoutTemplate: '_simpleChatListLayout',
  template: '_groupMessageList',
  data: function () {
    //var userId = this.params._user;
    var user = Meteor.user();
    var ids =  [];
    if (user && user.profile && user.profile.associated) {
      ids = _.pluck(user.profile.associated, 'id');
    }
    ids.push(Meteor.userId());
    // var lists = MsgSession.find({userId: {$in: ids},sessionType:'user'},{sort: {sessionType: 1, updateAt: -1}});
    var lists = withPostGroupChat ? MsgSession.find({userId: {$in: ids}},{sort: {updateAt: -1}, limit: Session.get('msgSessionLimit')}) : MsgSession.find({userId: {$in: ids},sessionType:'user'},{sort: {sessionType: 1, updateAt: -1}, limit: Session.get('msgSessionLimit')});
    Session.set('channel','simple-chat/user-list/'+Meteor.userId());
    return {
      title: '消息',
      isGroups: false,
      lists: lists
    };
  },
  action: function(){
    Session.set('msgSessionLimit', 40);
    SyncMsgSessionFromServer(Meteor.userId());
    this.render();
  // },
  // onStop: function() {
  //   console.log('user_list router onstop');
  //   Meteor.defer(function() {
  //     me = Meteor.user();
  //     typeArr = ["pcomment","pcommentReply","pfavourite","pcommentowner","getrequest","sendrequest","recommand","recomment","comment"];
  //     Meteor.call('resetMessageReadCount', Meteor.userId(), typeArr);

  //     user = Meteor.user();
  //     ids =  [];
  //     if (user && user.profile && user.profile.associated)
  //       ids = _.pluck(user.profile.associated, 'id');
  //     ids.push(Meteor.userId());
  //     if (withPostGroupChat)
  //       MsgSession.update({userId: {$in: ids}}, {$set: {count: 0}}, {multi: true});
  //     else
  //       MsgSession.update({userId: {$in: ids}, sessionType:'user'}, {$set: {count: 0}}, {multi: true});
  //   });
  }
});

var sendHaveReadMsg = function(page_data){
  var msg = {
      _id: new Mongo.ObjectID()._str,
      form:page_data.sender,
      to: {id:page_data.id},
      to_type: 'user',
      type: 'haveReadMsg',
      create_time: new Date(Date.now() + MQTT_TIME_DIFF),
      send_status: 'sending'
    };
  var callback = function(err){
    if(timeout){
      Meteor.clearTimeout(timeout);
      timeout = null;
    }
    if (err){
      console.log('send mqtt err:', err);
      //return Messages.update({_id: msg._id}, {$set: {send_status: 'failed'}});
      sendMqttUserMessage(msg.to.id, msg, arguments.callee);
    }
    //Messages.update({_id: msg._id}, {$set: {send_status: 'success'}});
  };
  var timeout = Meteor.setTimeout(function(){
    if (msg && msg.send_status === 'sending');
      sendMqttUserMessage(msg.to.id, msg, callback);
  }, 1000*60*2);
  sendMqttUserMessage(msg.to.id, msg, callback);
}

var keyboardHeightHandleThrottle = new throttleClass(200, 800);
var keyboardHeightHandle = function(event){
  // keyboardHeightHandleThrottle.run(function(){
    console.log ('Keyboard height is: ' + event.keyboardHeight);
    Session.set('keyboardHeight',event.keyboardHeight);
    if (event.keyboardHeight === 0) {
      if (!$simple_chat)
        $simple_chat = $('.simple-chat');
      $simple_chat.height('100%');
    }
  // });
};

var winResizeThrottle = new throttleClass(500, 1000);
window.onresize = function(){
  winResizeThrottle.run(function(){
    console.log('window height:'+$(window).height());
    if(Meteor.isCordova && device.platform === 'iOS'){
      // Meteor.setTimeout(function(){
        var keyboardHeight = Session.get('keyboardHeight');
        var maxWindowHeight = Session.get('currentWindowHeight'); //不弹键盘时的高度;
        if ((maxWindowHeight - $(window).height() <= 20 ) && keyboardHeight > 0) {
          if (!$simple_chat)
            $simple_chat = $('.simple-chat');
          $simple_chat.height($(window).height()-keyboardHeight);
        }
        if (keyboardHeight === 0) {
          if (!$simple_chat)
            $simple_chat = $('.simple-chat');
          $simple_chat.height('100%');
        }
      // },100);
    }
  });
};

Template._simpleChatToChatLayout.onRendered(function(){
  page_data = this.data;
  if(Meteor.isCordova && device && device.platform === 'iOS'){
    try{
      Keyboard.shrinkView(true);
      Keyboard.disableScrollingInShrinkView(true);
      window.addEventListener('keyboardHeightWillChange', keyboardHeightHandle);
    } catch (err){
      console.log(err)
    }
  }
  //开启已读消息模式
  if (withEnableHaveReadMsg && page_data.type === 'user') {
    // var lastMsg =  Messages.findOne({'form.id': page_data.id, 'to.id': page_data.sender.id, to_type: page_data.type},{ sort: {create_time: -1}});
    var _lastMsg =  Messages.findArrySortBy_Id({'form.id': page_data.id, 'to.id': page_data.sender.id, to_type: page_data.type},{ limit: 1}, false);
    if(_lastMsg && _lastMsg.length > 0)
      lastMsg = _lastMsg[0]

    if (lastMsg && lastMsg.is_read === false) {
      sendHaveReadMsg(page_data);
    }
  }
});
Template._simpleChatToChatLayout.onDestroyed(function(){
  page_data = null;
  if(Meteor.isCordova && device && device.platform === 'iOS'){
    try{
      Keyboard.shrinkView(false);
      Keyboard.disableScrollingInShrinkView(false);
      window.removeEventListener('keyboardHeightWillChange', keyboardHeightHandle);
      if (!$simple_chat)
        $simple_chat = $('.simple-chat');
      $simple_chat.height('100%');
    } catch (err){
      console.log(err)
    }
  }
});

var time_list = [];
var init_page = false;
var fix_data_timeInterval = null;
var fix_data = function(){
  var data = page_data.messages();// message_list.get(); //Blaze.getData($('.simple-chat')[0]).messages.fetch();
  data.sort(function(a, b){
    return a.create_time - b.create_time;
  });
  if(data.length > 0){
    for(var i=0;i<data.length;i++){
      data[i].show_time_str = get_diff_time(data[i].create_time);
      if(i===0)
        data[i].show_time = true;
      else if(data[i].show_time_str != data[i-1].show_time_str)
        data[i].show_time = true;
      else
        data[i].show_time = false;
    }
  }
  list_data.set(data);
};
var get_people_names = function(){
  var names = People.find({}, {sort: {updateTime: -1}, limit: 50}).fetch();
  var result = [];
  if(names.length > 0){
    for(var i=0;i<names.length;i++){
      if(result.indexOf(names[i].name) === -1)
        result.push(names[i].name);
    }
  }

  return result;
};

var onFixName = function(id, uuid, his_id, url, to, value, type){
  var user = Meteor.user();
  var images = [];

  if (url && Object.prototype.toString.call(url) === '[object Array]'){
    for(var i=0;i<url.length;i++)
      images.push({
        _id: new Mongo.ObjectID()._str,
        people_his_id: his_id,
        url: url[i].url
      });
  }

  var msg = {
    _id: new Mongo.ObjectID()._str,
    form: {
      id: user._id,
      name: user.profile && user.profile.fullname ? user.profile.fullname : user.username,
      icon: user.profile && user.profile.icon ? user.profile.icon : '/userPicture.png'
    },
    to: to,
    images: images,
    to_type: "group",
    type: "text",
    create_time: new Date(Date.now() + MQTT_TIME_DIFF),
    people_id: id,
    people_uuid: uuid,
    people_his_id: his_id,
    is_read: false
  };

  switch(type){
    case 'label':
      msg.text = '此照片是"' + value + '" ~';
      Messages.insert(msg);
      sendMqttGroupMessage(msg.to.id, msg);
      // sendMqttMessage('workai', msg);
      // sendMqttMessage('trainset', {url: url, person_id: '', device_id: uuid, face_id: id});
      break;
    case 'check':
      msg.text = '此照片是"' + value + '" ~';
      Messages.insert(msg);
      sendMqttGroupMessage(msg.to.id, msg);
      // sendMqttMessage('workai', msg);
      // sendMqttMessage('trainset', {url: url, person_id: '', device_id: uuid, face_id: id});
      break;
    case 'remove':
      msg.text = '删除照片: ' + value;
      Messages.insert(msg);
      sendMqttGroupMessage(msg.to.id, msg);
      // sendMqttMessage('workai', msg);
      if (url && Object.prototype.toString.call(url) === '[object Array]'){
        url.forEach(function(img){
          sendMqttMessage('trainset', {url: img.url, person_id: '', device_id: uuid, face_id: id, drop: true});
        });
      }else{
        sendMqttMessage('trainset', {url: url, person_id: '', device_id: uuid, face_id: id, drop: true});
      }
      break;
  };
  Meteor.setTimeout(function() {
    $('.simple-chat-label').remove();
    $('#swipebox-overlay').remove();
  }, 500);
};

var showBoxView = null;
var showBox = function(title, btns, list, tips, callback){
  if(showBoxView)
    Blaze.remove(showBoxView);
  showBoxView = Blaze.renderWithData(Template._simpleChatToChatLabelBox, {
    title: title,
    btns: btns || ['知道了'],
    list: list,
    tips: tips,
    callback: callback || function(){},
    remove: function(){Blaze.remove(showBoxView);}
  }, document.body);
};
Template._simpleChatToChatLabelBox.events({
  'click .mask': function(e, t){
    t.data.remove();
  },
  'click .my-btn': function(e, t){
    var index = 0;
    var btns = t.$('.my-btn');
    var value = t.$('select').val() || t.$('input').val();

    for(var i=0;i<btns.length;i++){
      if(btns[i].innerHTML === $(e.currentTarget).html()){
        index = i;
        break;
      }
    }
    console.log('selected:', index, value);
    t.data.remove();
    t.data.callback(index, value);
  },
  'change select': function(e, t){
    var $input = t.$('input');
    var $select = t.$('select');

    if($(e.currentTarget).val() === ''){
      $select.hide();
      $input.show();
    }else{
      $input.hide();
      $select.show();
    }
  }
});

Template._simpleChatToChat.onDestroyed(function(){
  if(fix_data_timeInterval){
    Meteor.clearInterval(fix_data_timeInterval);
    fix_data_timeInterval = null;
  }
  var self = this;
  if(self.data.type != 'user'){
    Session.set('chat_group_title',page_title.get());
  }
});

var setMsgList = function(where, action){
  if(action === 'insert' || action === 'remove'){Meteor.setTimeout(function(){$('.box').scrollTop($('.box ul').height());}, 200);}
};

var toUsers = {};
if (localStorage.getItem('_simple_chat_to_users'))
  toUsers = JSON.parse(localStorage.getItem('_simple_chat_to_users'));
var setToUsers = function(data){
  if (data && !page_data)
    page_data = data;
  if (page_data.type != 'user'){
    toUsers[page_data.type+'.'+page_data.id] ={
      name: page_data.name || '聊天室',
      icon: page_data.icon || '/userPicture.png'
    };
  } else {
    var user = Meteor.users.findOne({_id: page_data.id});
    if (user)
      toUsers[page_data.type+'.'+page_data.id] = {
        name: user.profile && user.profile.fullname ? user.profile.fullname : user.username,
        icon: user.profile && user.profile.icon ? user.profile && user.profile.icon : '/userPicture.png'
      };
    else if (page_data.name)
      toUsers[page_data.type+'.'+page_data.id] = {
        name: page_data.name,
        icon: page_data.icon || '/userPicture.png'
      };
  }
  console.log('==setToUsers=='+JSON.stringify(toUsers));
  localStorage.setItem('_simple_chat_to_users', JSON.stringify(toUsers));
};

Template._simpleChatToChat.onRendered(function(){
  Session.set('currentWindowHeight',$(window).height());

  $('.box').on('touchstart',function(e) {
    $('.input-text').blur();
    footerView.set('');
    // hasInputing.set(false);
    hasFooterView.set(false);
    // setTimeout(function(){
    //   renderFootBody();
    //   // setTimeout(scrollToBottom, CHAT_RENDER_TIME);
    // }, CHAT_RENDER_TIME);
  });

  console.log('=====emplate._simpleChatToChat.onRendered=====');
  is_loading.set(true);
  list_limit.set(list_limit_val);
  time_list = [];
  init_page = false;
  list_data.set([]);
  message_list.set([]);
  var slef = this;

  if (!Messages.onBefore){
    Messages.after.insert(function (userId, doc) {
      if (!page_data)
        return;
      if (doc.to_type === page_data.type && doc.to.id === page_data.id){
        console.log('message insert');
        setMsgList(page_data.where, 'insert');
      }
      if (withEnableHaveReadMsg && doc.to_type === 'user' && doc.form.id === page_data.id) {
        console.log('receive other message')
        sendHaveReadMsg(page_data);
      }
    });
    Messages.after.update(function (userId, doc, fieldNames, modifier, options) {
      if (!page_data)
        return;
      if (doc.to_type === page_data.type && doc.to.id === page_data.id){
        console.log('message update');
        setMsgList(page_data.where, 'update');
      }
    });
    Messages.after.remove(function (userId, doc){
      console.log('message remove');
      if (!page_data)
        return;
      if (doc.to_type === page_data.type && doc.to.id === page_data.id){
        console.log('message update');
        setMsgList(page_data.where, 'remove');
      }
    });
    Messages.onBefore = true;
  }

  if(fix_data_timeInterval){
    Meteor.clearInterval(fix_data_timeInterval);
    fix_data_timeInterval = null;
  }
  // fix_data_timeInterval = Meteor.setInterval(fix_data, 1000*60);
  Meteor.subscribe('people_new', function(){});

  Meteor.subscribe('get-messages-new', slef.data.type, slef.data.id, {onStop: function(err){
    err && console.log('get-messages error:', err);
    !err && console.log('get-messages stop');
    setToUsers(slef.data);
    init_page = true;
    $('.box').scrollTop($('.box ul').height());
    is_loading.set(false);
  }, onReady: function(){
    console.log('get-messages ready');
    if(slef.data.type != 'user'){
      // page_title.set(Groups.findOne({_id: slef.data.id}) ? Groups.findOne({_id: slef.data.id}).name : '聊天室');
      page_title.set(AppConfig.get_group_title());
    }else{
      var user = Meteor.users.findOne({_id: slef.data.id});
      page_title.set(AppConfig.get_user_name(user));
    }
    setToUsers(slef.data);

    init_page = true;
    $('.box').scrollTop($('.box ul').height());
    is_loading.set(false);
  }});

  var $_box = $('.box');
  var getLastMsgTime = null;
  var getLastMsg = function(){
    getLastMsgTime && Meteor.clearTimeout(getLastMsgTime);
    getLastMsgTime = Meteor.setTimeout(function(){
      var top = $_box.height() + $_box.scrollTop();
      $_box.find('ul.group-list > li').each(function(){
        var $li = $(this);
        if ($li[0].offsetTop >= top){
          console.log('==>', $li.attr('id'));
        }
      });
    }, 300);
  };

  var boxScrollThrottle = new throttleClass(1000, 2000);
  var before = $_box.scrollTop();
  $_box.scroll(function () {
    boxScrollThrottle.run(function(){
      if (!$chat_box)
        $chat_box = $('.msg-box .box');
      if($chat_box.scrollTop() === 0 && !is_loading.get()){
        // if(slef.data.messages.count() >= list_limit.get())
        is_loading.set(true);
        list_limit.set(list_limit.get()+list_limit_val);
        Meteor.setTimeout(function(){is_loading.set(false);}, 500);
      }

      // 滚动方向
      var after = $_box.scrollTop();
      var direction = '';
      if (before>after)
        direction = 'up';
      if (before<after)
        direction = 'down';
       before = after;

      // 处理新消息（滚动条后面的未读）
      // if (direction === 'down')
      //   getLastMsg();
    });
  });
});

Template._simpleChatToChatItem.events({
  'click .audio': function(e){
    var url = $(e.currentTarget).data("url");
    var time = $(e.currentTarget).data("time");

    // console.log($(this));
    // console.log(url,time);
    // console.log($(".audio").data("url"));
    var my_media = new Media(url,
        // success callback
        function () {
            console.log("playAudio():Audio Success");
        },
        // error callback
        function (err) {
            console.log("playAudio():Audio Error: " + err);
        }
    );
    console.log('播放语音');
    // Play audio
    my_media.play();
    // var w = $(this).innerWidth();
    // var w1 = $(this).width();
    // console.log(w,w1)
  },
  'click li .text a': function(e){
    var href = $(e.currentTarget).attr('href');
    if(Meteor.isCordova){
      openWithThemeBrowser(href);
    } else {
      window.location.href = href;
    }
  },
  'click li img.swipebox': function(e){
    var scrollTopbefore = $('.box').scrollTop();
    var imgs = [];
    var index = 0;
    var selected = 0;
    var data = Blaze.getData($(e.currentTarget).attr('data-type') === 'images' ? $(e.currentTarget).parent().parent().parent()[0] : $('#'+this._id)[0]);
    console.log('scrollTopbefore:', scrollTopbefore);
    // console.log('data:', data);
    // $('li#' + data._id + ' img.swipebox').each(function(){
    //   imgs.push({
    //     href: $(this).attr('src'),
    //     title: ''
    //   });
    //   if($(e.currentTarget).attr('src') === $(this).attr('src'))
    //     selected = index;
    //   index += 1;
    // });
    if(data.images.length > 0){
      for(var i=0;i<data.images.length;i++){
        imgs.push({
          href: data.images[i].url,
          title: ''
        });
        if(data.images[i].url === $(e.currentTarget).attr('src'))
          selected = i;
      }
    }
    if(imgs.length > 0){
      console.log('imgs:', imgs);
      var labelView = null;

      $.swipebox(imgs, {
        initialIndexOnArray: selected,
        hideCloseButtonOnMobile : true,
        loopAtEnd: false,
        // beforeOpen: function(){
        //   if (data.people_id)
        //     labelView = Blaze.renderWithData(Template._simpleChatToChatLabel, data, document.body);
        // },
        // afterClose: function(){
        //   if (data.people_id)
        //     Blaze.remove(labelView);
        // },
        // indexChanged: function(index){
        //   var data = Blaze.getData($('.simple-chat-label')[0]);
        //   var $img = $('#swipebox-overlay .slide.current img');

        //   console.log($img.attr('src'));
        //   console.log(_.pluck(data.images, 'url'));
        //   Session.set('SimpleChatToChatLabelImage', data.images[index]);
        // }
      });
    }
    Meteor.setTimeout(function(){
      $('.box').scrollTop(scrollTopbefore)
    }, 1800);
  },
  'click .sendfailed':function(e){
    sendMqttMsg(this);
  },
  'click li div.showmore':function(e){
    console.log(e.currentTarget.id);
    id = e.currentTarget.id;
    $('li#' + id + ' div.showmore').hide();
    $('li#' + id + ' div.text .imgs').removeAttr('style');
    $('li#' + id + ' div.text .imgs-1-box').removeAttr('style');
  },
  'click li div.schat_post_abstract':function(e){
    console.log(e.currentTarget.id);
    var postId = e.currentTarget.id;

    // console.log("e val is: ", JSON.stringify(e.currentTarget.innerText));
    // text = JSON.stringify(e.currentTarget.innerText);
    // firstSubstring = "第";
    // secSubsrting = "段的评论";
    // subtext = text.match(new RegExp(firstSubstring + "(.*)" + secSubsrting));
    // console.log("sub text is: ", subtext[1]);
    // paraIndex = subtext[1];
    var history = Session.get('history_view') || [];
    var paraIndex = $(e.currentTarget).data('pindex');
    // var owner = $(e.currentTarget).data('owner');
    // var ownerName = $(e.currentTarget).data('ownername');
    var owner = page_data.id;
    var ownerName = page_data.name;
    if (page_data.type == 'group') {
      history.push({
        view: 'simple-chat/to/group?id='+owner + '&name='+encodeURIComponent(page_data.name)+'&icon='+encodeURIComponent(page_data.icon),
        scrollTop: document.body.scrollTop
      });
    }
    else {
      history.push({
        view: 'simple-chat/to/user?id='+owner,
        scrollTop: document.body.scrollTop
      });
    }

    Session.set("history_view", history);

    if (paraIndex){
      Session.set("pcurrentIndex", paraIndex);
      Session.set("pcommetsId", this.form.id);
      Session.set("pcommentsName", this.form.name);
      Session.set("toasted", false);
      console.log('ispcomment---'+paraIndex+'---'+owner+'---'+ownerName+'---'+$(e.currentTarget).data('ispcomment'))
      if ($(e.currentTarget).data('ispcomment')) {
        Session.set("isPcommetReply", true);
      } else {
        Session.set("isPcommetReply", false);
      }
    }
    Router.go('/posts/' + postId);
  },
  'click .check': function(){
    Template._simpleChatLabelDevice.open(this);
    // var data = this;
    // var names = get_people_names();

    // show_label(function(name){
    //   Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
    //     if(err)
    //       return PUB.toast('标记失败，请重试~');

    //     console.log(res);
    //     PeopleHis.update({_id: data.people_his_id}, {
    //       $set: {fix_name: name, msg_to: data.to},
    //       $push: {fix_names: {
    //         _id: new Mongo.ObjectID()._str,
    //         name: name,
    //         userId: Meteor.userId(),
    //         userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
    //         userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
    //         fixTime: new Date()
    //       }}
    //     }, function(err, num){
    //       if(err || num <= 0){
    //         return PUB.toast('标记失败，请重试~');
    //       }

    //       data.images.forEach(function(img) {
    //         Messages.update({_id: data.msg_id, 'images.url': img.url}, {
    //           $set: {
    //             'images.$.label': name,
    //             'images.$.result': ''
    //           }
    //         });
    //         sendMqttMessage('trainset', {url: img.url, person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
    //       });

    //       onFixName(data.people_id, data.people_uuid, data.people_his_id, data.images, data.to, name, 'label');
    //       PUB.toast('标记成功~');
    //     });
    //   });
    // });
  },
  'click .crop':function(){
    Template._simpleChatLabelCrop.open(this);
  },
  'click .remove': function(){
    Template._simpleChatLabelRemove.open(this);
  },
  'click .yes': function(){
    // update label
    var setNames = [];
    for (var i=0;i<this.images.length;i++){
      if (this.images[i].label) {
        var trainsetObj = {group_id: this.to.id, type: 'trainset', url: this.images[i].url, person_id: '', device_id: this.people_uuid, face_id: this.images[i].id, drop: false};
        console.log("##RDBG trainsetObj: " + JSON.stringify(trainsetObj));
        sendMqttMessage('/device/'+this.to.id, trainsetObj);
      }

      if (_.pluck(setNames, 'id').indexOf(this.images[i].id) === -1)
        setNames.push({uuid: this.people_uuid, id: this.images[i].id, url: this.images[i].url, name: this.images[i].label});
    }
    if (setNames.length > 0)
      Meteor.call('set-person-names', setNames);

    // update collection
    Messages.update({_id: this._id}, {$set: {label_complete: true}});

    // var data = this;
    // var names = get_people_names();
    // var name = data.images[0].label;

    // Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
    //   if(err)
    //     return PUB.toast('标记失败，请重试~');

    //   console.log(res);
    //   PeopleHis.update({_id: data.people_his_id}, {
    //     $set: {fix_name: name, msg_to: data.to},
    //     $push: {fix_names: {
    //       _id: new Mongo.ObjectID()._str,
    //       name: name,
    //       userId: Meteor.userId(),
    //       userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
    //       userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
    //       fixTime: new Date()
    //     }}
    //   }, function(err, num){
    //     if(err || num <= 0){
    //       return PUB.toast('标记失败，请重试~');
    //     }

    //     data.images.forEach(function(img) {
    //       Messages.update({_id: data.msg_id, 'images.url': img.url}, {
    //         $set: {
    //           'images.$.label': name,
    //           'images.$.result': ''
    //         }
    //       });
    //       sendMqttMessage('trainset', {url: img.url, person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
    //     });

    //     onFixName(data.people_id, data.people_uuid, data.people_his_id, data.images, data.to, name, 'label');
    //     PUB.toast('标记成功~');
    //   });
    // });
  },
  'click .no': function(){
    Template._simpleChatLabelLabel.open(this);
    // var data = this;
    // var names = get_people_names();

    // showBox('提示', ['重新标记', '删除'], null, '你要重新标记照片还是删除？', function(index){
    //   if(index === 0)
    //     show_label(function(name){
    //       Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
    //         if(err)
    //           return PUB.toast('标记失败，请重试~');

    //         PeopleHis.update({_id: data.people_his_id}, {
    //           $set: {fix_name: name, msg_to: data.to},
    //           $push: {fix_names: {
    //             _id: new Mongo.ObjectID()._str,
    //             name: name,
    //             userId: Meteor.userId(),
    //             userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
    //             userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
    //             fixTime: new Date()
    //           }}
    //         }, function(err, num){
    //           if(err || num <= 0){
    //             return PUB.toast('标记失败，请重试~');
    //           }

    //           data.images.forEach(function(img) {
    //             Messages.update({_id: data.msg_id, 'images.url': img.url}, {
    //               $set: {
    //                 'images.$.label': name,
    //                 'images.$.result': ''
    //               }
    //             });
    //             sendMqttMessage('trainset', {url: img.url, person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
    //           });

    //           onFixName(data.people_id, data.people_uuid, data.people_his_id, data.images, data.to, name, 'label');
    //           PUB.toast('标记成功~');
    //         });
    //       });
    //     });
    //   else
    //     show_remove(function(text){
    //       PeopleHis.update({_id: data.people_his_id}, {
    //         $set: {msg_to: data.to},
    //         $push: {fix_names: {
    //           _id: new Mongo.ObjectID()._str,
    //           userId: Meteor.userId(),
    //           userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
    //           userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
    //           fixTime: new Date(),
    //           fixType: 'remove',
    //           removeText: text
    //         }}
    //       }, function(err, num){
    //         if(err || num <= 0){
    //           console.log(err);
    //           return PUB.toast('删除失败，请重试~');
    //         }

    //         data.images.forEach(function(img) {
    //           Messages.update({_id: data.msg_id, 'images.url': img.url}, {
    //             $set: {
    //               'images.$.result': 'remove'
    //             }
    //           });
    //         });

    //         onFixName(data.people_id, data.people_uuid, data.people_his_id, data.images, data.to, text, 'remove');
    //         PUB.toast('删除成功~');
    //       });
    //     });
    // });
  },
  'click .show_more': function(e, t){
    var $li = $('li#' + this._id);
    var $imgs = $li.find('.text .imgs');
    var $labels = $li.find('.text .imgs-1-item');
    var $show = $li.find('.show_more');

    if ($imgs.css('height') === '70px' || $labels.css('height') === '55px'){
      $imgs.css('height', 'auto');
      $labels.css('height', 'auto');
      $show.html('<i class="fa fa-angle-up"></i>');
    } else {
      $imgs.css('height', '70px');
      $labels.css('height', '55px');
      $show.html('<i class="fa fa-angle-right"></i>');
    }
  }
});

Template._simpleChatToChatLabel.helpers({
  data: function(){
    return Session.get('SimpleChatToChatLabelImage');
  }
});

Template._simpleChatToChatLabel.events({
  'click .btn-label.yes': function(){
    var $img = $('#swipebox-overlay .slide.current img');
    var data = this;
    var names = get_people_names();

    show_label(function(name){
      Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
        if(err)
          return PUB.toast('标记失败，请重试~');

        console.log(res);
        PeopleHis.update({_id: data.people_his_id}, {
          $set: {fix_name: name, msg_to: data.to},
          $push: {fix_names: {
            _id: new Mongo.ObjectID()._str,
            name: name,
            userId: Meteor.userId(),
            userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
            userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
            fixTime: new Date()
          }}
        }, function(err, num){
          if(err || num <= 0){
            return PUB.toast('标记失败，请重试~');
          }

          Messages.update({_id: data.msg_id, 'images.url': $img.attr('src')}, {
            $set: {
              'images.$.label': name,
              'images.$.result': ''
            }
          });

          onFixName(data.people_id, data.people_uuid, data.people_his_id, $img.attr('src'), data.to, name, 'label');
          sendMqttMessage('trainset', {url: $img.attr('src'), person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
          PUB.toast('标记成功~');
        });
      });
    });
  },
  'click .btn-yes': function(){
    var $img = $('#swipebox-overlay .slide.current img');
    var data = this;
    var name = data.images[0].label;

    Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
      if(err)
        return PUB.toast('标记失败，请重试~');

      PeopleHis.update({_id: data.people_his_id}, {
        $set: {fix_name: name, msg_to: data.to},
        $push: {fix_names: {
          _id: new Mongo.ObjectID()._str,
          name: name,
          userId: Meteor.userId(),
          userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
          userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
          fixTime: new Date()
        }}
      }, function(err, num){
        if(err || num <= 0){
          return PUB.toast('标记失败，请重试~');
        }

        Messages.update({_id: data.msg_id, 'images.url': $img.attr('src')}, {
          $set: {
            'images.$.label': name,
            'images.$.result': ''
          }
        });

        onFixName(data.people_id, data.people_uuid, data.people_his_id, $img.attr('src'), data.to, name, 'label');
        sendMqttMessage('trainset', {url: $img.attr('src'), person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
        PUB.toast('标记成功~');
      });
    });
  },
  'click .btn-no': function(){
    var $img = $('#swipebox-overlay .slide.current img');
    var data = this;
    var name = Session.get('SimpleChatToChatLabelImage').label;
    var names = get_people_names();

    showBox('提示', ['重新标记', '删除'], null, '你要重新标记照片还是删除？', function(index){
      if(index === 0)
        show_label(function(name){
          Meteor.call('get-id-by-name', data.people_uuid, name, function(err, res){
            if(err)
              return PUB.toast('标记失败，请重试~');

            PeopleHis.update({_id: data.people_his_id}, {
              $set: {fix_name: name, msg_to: data.to},
              $push: {fix_names: {
                _id: new Mongo.ObjectID()._str,
                name: name,
                userId: Meteor.userId(),
                userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
                userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
                fixTime: new Date()
              }}
            }, function(err, num){
              if(err || num <= 0){
                return PUB.toast('标记失败，请重试~');
              }

              Messages.update({_id: data.msg_id, 'images.url': $img.attr('src')}, {
                $set: {
                  'images.$.label': name,
                  'images.$.result': ''
                }
              });

              onFixName(data.people_id, data.people_uuid, data.people_his_id, $img.attr('src'), data.to, name, 'label');
              sendMqttMessage('trainset', {url: $img.attr('src'), person_id: res.id ? res.id : '', device_id: data.people_uuid, face_id: res ? res.faceId : data.people_id, drop: false});
              PUB.toast('标记成功~');
            });
          });
        });
      else
        show_remove(function(text){
          PeopleHis.update({_id: data.people_his_id}, {
            $set: {msg_to: data.to},
            $push: {fix_names: {
              _id: new Mongo.ObjectID()._str,
              userId: Meteor.userId(),
              userName: Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username,
              userIcon: Meteor.user().profile && Meteor.user().profile.icon ? Meteor.user().profile.icon : '/userPicture.png',
              fixTime: new Date(),
              fixType: 'remove',
              removeText: text
            }}
          }, function(err, num){
            if(err || num <= 0){
              console.log(err);
              return PUB.toast('删除失败，请重试~');
            }

            Messages.update({_id: data.msg_id, 'images.url': $img.attr('src')}, {
              $set: {
                'images.$.result': 'remove'
              }
            });

            onFixName(data.people_id, data.people_uuid, data.people_his_id, $img.attr('src'), data.to, text, 'remove');
            PUB.toast('删除成功~');
          });
        });
    });
  }
});

var loadScript = function(url, callback){
  if($("script[src='"+url+"']").length > 0)
    return callback && callback();

  var script = document.createElement('script');
  script.type = 'text/javascript';
  if(script.readyState){
    script.onreadystatechange = function(){
      if(script.readyState === 'loaded' || script.readyState === 'complete'){
        script.onreadystatechange = null;
        callback && callback();
      }
    }
  }else{
    script.onload = function(){
      callback && callback();
    };
  }

  script.src = url;
  document.getElementsByTagName('head')[0].appendChild(script);
}
Template._simpleChatToChatLayout.onRendered(function(){
//  $("#simple-chat-text").autogrow({
//     maxHeight: 130,
//     postGrowCallback: function(){
//       var dif = $(".footbar").outerHeight();
//       if (dif <= 54) {
//         $("#simple-chat-text").css('padding-top', 5);
//         $("#simple-chat-text").css('padding-bottom', 5);
//       } else {
//         $("#simple-chat-text").css('padding-top', 0);
//         $("#simple-chat-text").css('padding-bottom', 0);
//       }
//       //$('.box')
//       if (dif <= 150) {
//         $(".simple-chat .msg-box .box").css('padding-bottom', dif);
//         console.log("Frank: Yes, outerHeight="+$(".footbar").outerHeight()+", dif = "+dif);
//       } else {
//         console.log("Frank: No, outerHeight="+$(".footbar").outerHeight()+", dif = "+dif);
//       }
//       var chatMessages = $(".simple-chat .msg-box .box");
//       if (chatMessages && chatMessages.get(0))
//         chatMessages.get(0).scrollTop = chatMessages.get(0).scrollHeight+99999;
//     }
//   });
  Meteor.subscribe('myBlackList');
  if(Meteor.isCordova){
    $('#container').click(function(){
      selectMediaFromAblum(1, function(cancel, result, currentCount, totalCount){
        if(cancel)
          return;
        if(result){
          var id = new Mongo.ObjectID()._str;
          window.___message.insert(id, result.filename, result.URI); // result.smallImage
          multiThreadUploadFile_new([{
            type: 'image',
            filename: result.filename,
            URI: result.URI
          }], 1, function(err, res){
            if(err || res.length <= 0)
              window.___message.update(id, null);
            else
              window.___message.update(id, res[0].imgUrl);
          });
        }
      });
    });
  }else{
    // load upload.js
    loadScript('/packages/feiwu_simple-chat/client/upload.js', function(){
      var uploader = SimpleChat.createPlupload('selectfiles');
      uploader.init();
    });
  }

  Meteor.setTimeout(function(){
    $('body').css('overflow', 'hidden');
    var DHeight = $('.group-list').outerHeight();
    $('.box').scrollTop(DHeight);
  }, 600);
});
Template._simpleChatToChatLayout.onDestroyed(function(){
  $('body').css('overflow', 'auto');
  //Session.set('msgToUserName', null);
  Session.set('msgFormUser', null);
});

Template._simpleChatToChatLayout.helpers({
  roomtitle: function(){
    if (Session.get('msgToUserName') && Session.get('msgToUserName') != '') {
      return Session.get('msgToUserName')
    }else{
      return page_title.get();
    }
  },
  loading: function(){
    return is_loading.get();
  },
  isGroups:function(){
    var data = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0]));
    return data.is_group();
  },
  isSubScribeUser: function(){
    var followerId = location.search.split("&")[0].replace('?id=', '');
    return  Follower.find({followerId: followerId, userId: Meteor.userId()}).count()>0
  }
});

sendMqttMsg = function(){
  var msg = _.clone(arguments[0]);
  // alert(msg.type)
  delete msg.send_status
  var callback = function(err){
    if(timeout){
      Meteor.clearTimeout(timeout);
      timeout = null;
    }
    if (err){
      console.log('send mqtt err:', err);
      return Messages.update({_id: msg._id}, {$set: {send_status: 'failed'}});
    }
    Messages.update({_id: msg._id}, {$set: {send_status: 'success'}});
  };
  var sendToGroupOrUser = function(msg,callback){
      if (msg.to_type === 'group'){
        sendMqttGroupMessage(msg.to.id, msg, callback);
      }
      else{
        sendMqttUserMessage(msg.to.id, msg,callback);
      }
  };
  var timeout = Meteor.setTimeout(function(){
    var obj = Messages.findOne({_id: msg._id});
    if (obj && obj.send_status === 'sending')
      Messages.update({_id: msg._id}, {$set: {send_status: 'failed'}});
  }, 1000*15);

  Messages.update({_id: msg._id}, {$set: {send_status: 'sending'}});
  if (msg.type === 'image'){
    if(!msg.images[0].url){
      return multiThreadUploadFile_new([{
        type: 'image',
        filename: msg.images[0].filename,
        URI: msg.images[0].uri
      }], 1, function(err, res){
        if(err || res.length <= 0)
          return callback(new Error('upload error'));

        if(timeout){
          Meteor.clearTimeout(timeout);
          timeout = null;
        }
        window.___message.update(id, res[0].imgUrl);
        msg = Messages.findOne({_id: msg.to.id});
        // sendMqttGroupMessage(msg.to.id, msg, callback);
        sendToGroupOrUser(msg,callback);
      });
    }
  }
  if (msg.type === 'audio'){
    if(!msg.audios[0].url){
      return multiThreadUploadFile_new([{
        type: 'audio',
        filename: msg.audios[0].filename,
        URI: msg.audios[0].uri
      }], 1, function(err, res){
        if(err || res.length <= 0)
          return callback(new Error('upload error'));
        if(timeout){
          Meteor.clearTimeout(timeout);
          timeout = null;
        }
        window.___message.update(id, res[0].imgUrl);
        msg = Messages.findOne({_id: msg.to.id});
        //sendMqttGroupMessage(msg.to.id, msg, callback);
        sendToGroupOrUser(msg,callback);
      });
    }
  }
  sendToGroupOrUser(msg,callback);

};

var mediaRec = null;
var timer;
var timer1;
var files =0;
var flag = true;
Template._simpleChatToChatLayout.events({
  'click .ta div.icon': function(e){
    console.log('i clicked a chat userICON');
    if (Session.get('chatTouching')) {
      console.log('chatTouching is on, ignore click event');
      return;
    }
    var to_id = '';
    if (this.to_type === 'user') {
      to_id = this.form.id
    }
    else{
      to_id = this.to.id
    }
    // Session.set('pageToProfile',AppConfig.path + '/to/'+this.to_type+'?id='+to_id);
    var backpath = AppConfig.path + '/to/'+this.to_type+'?id='+to_id;
    var history = Session.get("history_view") || [];
    history.push({
        view: backpath.substr(1),
        scrollTop: $(window).scrollTop()
    });
    Session.set("history_view", history);
    Router.go('/userProfilePageOnly/' + this.form.id);
  },
  'click #subscribeUser': function(e){
    var user  = Meteor.user();
    var toUserId = location.search.split("&")[0].replace('?id=', '');
    var toUser = Meteor.users.findOne({_id: toUserId});
    return addFollower({
      userId: Meteor.userId(),
      userName: AppConfig.get_user_name(user),
      userIcon: AppConfig.get_user_icon(user),
      userDesc: Meteor.user().profile.desc,
      followerId: toUserId,
      followerName: AppConfig.get_user_name(toUser),
      followerIcon: AppConfig.get_user_icon(toUser),
      followerDesc: toUser.profile.desc,
      createAt: new Date()
    });
  },
  'click #addToBlacklist': function(e){
    try{
      var blackerId = location.search.split("&")[0].replace('?id=', '');
      addIntoBlackList(blackerId);
    } catch (err){
      console.log('black err=',err);
    }
  },
  'click #reporterUser': function(){
    // TODO
    console.log('reporterUser')
    userId = location.search.split("&")[0].replace('?id=', '');
    Session.set('reportUser',{
      userId:userId,
      userName: page_title.get()
    })
    Router.go('reportPost')
  },
  'focus .input-text': function(){
    $('.box').animate({scrollTop:'999999px'},800)
    // Meteor.setTimeout(function(){
    //   $('body').scrollTop(999999);
    // }, 500);
  },
  'click .groupsProfile':function(e,t){
    var data = page_data;
    history = Session.get('history_view') || [];
    history.push({
      view: Router.current().url.substr(1),
      scrollTop: document.body.scrollTop
    });
    Session.set('history_view',history);
    Router.go('/groupsProfile/'+data.type+'/'+data.id);
  },

  'click .sendInfo':function(e,t){
    e.preventDefault();
    $(".fa1").toggle();
    $(".fa2").toggle();
    $(".f3").toggle();
    $("textarea").toggle()
  },
   'touchstart .f3':function(e){
    e.preventDefault();
    $(".model").show();
    $(".f3").text("松开 结束");
    $(".model-text").removeClass('toggle');
    console.log('touch start');
    //录音文件名
     var recName = Meteor.userId()+new Date().getTime() + ".mp3";
     mediaRec = new Media(recName,
        // success callback
        function() {
          console.log("recordAudio():Audio Success");
          console.log("录音中:"+recName);
        },
        // error callback
        function(err) {
          console.log('录音失败');
          console.log(err);
          console.log(err.code);
          PUB.toast('请检查权限是否开启');
        }
     );
    // Record audio开始录音
    mediaRec.startRecord();
    index = 0;
    timer = setInterval(function(){
      console.log('index:'+index);
      index++;
    //   if(index == 50){
    //     var count = 10;
    //     timer1 = setInterval(function(){
    //       count--;
    //       console.log('count:'+count);
    //       $(".model-text").text("还可以说"+count+"秒");
    //       if(count == 0){
    //         clearInterval(timer1);
    //         flag = false;
    //         $(".model").hide();
    //         $(".model-text").text("松开手指 发送语音");
    //         $(".f3").text("按住说话");
    //         //stop结束录音
    //         mediaRec.stopRecord();
    //         console.log('1 min end');
    //         var id = new Mongo.ObjectID()._str;
    //         var filename = recName;
    //         // window.___message.insert(id, filename, URI);
    //         window.uploadToAliyun_new(filename, "file:///storage/emulated/0/"+filename, function(status, result){
    //           if (status === 'done' && result){
    //             // window.___message.update(id, result);
    //             // setTimeout(scrollToBottom, 100);
    //           }
    //         });
    //       }
    //     },1000)
    //   }
    //   if(index >= 60){
    //     clearInterval(timer);
    //   }
    },1000)
  },
  'touchend .f3' :function(e){
    e.preventDefault();
    clearInterval(timer);
    clearInterval(timer1);
    $(".model").hide();
    $(".f3").text("按住说话");
    console.log('touchend,flag:'+flag);
    //stop结束录音。
    if(mediaRec !== null){
      if(flag){
         mediaRec.stopRecord();
         console.log('停止录音');
         console.log(mediaRec);
         console.log(mediaRec.src);
         var id = new Mongo.ObjectID()._str;
         var filename = mediaRec.src;
         var url = null;
         if(device.platform == "Android"){
            url = cordova.file.externalRootDirectory + mediaRec.src;
         }else if(device.platform == 'iOS'){
            url = cordova.file.tempDirectory + mediaRec.src;
         }
         // console.log(id)
         // console.log(url)
        //  mediaRec.release();
        // index = mediaRec.getDuration();
         window.___messageAudio.insert(id, filename, url,index);
         window.uploadToAliyun_new(filename, url, function(status, result){
            console.log('result:' + result + ',status:' + status);
            if (status === 'done' && result){
              window.___messageAudio.update(id, result,index);
              setTimeout(scrollToBottom, 100);
            }
         });
      }else{
        flag = true;
    }
      }
  },






  // 'click .userProfile':function(e,t){
  //   var data = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0]));
  //   Router.go('/groupsProfile/'+data.type+'/'+data.id);
  //   //PUB.page('/simpleUserProfile/'+data.id);
  // }

});

Template._simpleChatToChatItem.onRendered(function(){
  var data = this.data;
  var isGroups = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0])).is_group();
  // if (data.form.id === Meteor.userId() && data.send_status === 'sending')
  //   sendMqttMsg(data);
  touch.on(this.$('li a'),'hold',function(ev){
    ev.preventDefault();
    ev.stopPropagation();
    var link = $(this).text()
    console.log(link);
    window.plugins.actionsheet.show({
      title:'复制或打开链接~',
      buttonLabels: ['复制链接','打开链接'],
      addCancelButtonWithLabel: '取消',
      androidEnableCancelButton: true
    }, function(index){
      if(index === 1){
        cordova.plugins.clipboard.copy(link,function(){
          PUB.toast('链接已复制');
        },function(){
          PUB.toast('复制失败');
        });
      } else if(index === 2){
        openWithThemeBrowser(link);
      }
    })
  });
  if(isGroups){
    touch.on(this.$('li .icon'),'hold',function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      Session.set('chatTouching', true);
      console.log('data is -----------')
      console.log(data)
      var username = data.form.name;
      var userId = data.form.id;
      var userData = {
        id: userId,
        name: username
      }
      var userArr = [];
      if(Session.get('pushNotiUsers')){
        userArr = Session.get('pushNotiUsers');
      }
      userArr.push(userData)
      Session.set('pushNotiUsers',userArr);
      
      $('.input-text').val($('.input-text').val() + '@' + username + ' ');
      Meteor.setTimeout(function(){
        $('#simple-chat-text').select();
      }, 100);
      Meteor.setTimeout(function(){
        console.log('release touch lock');
        Session.set('chatTouching', false);
      }, 5000);
    });
  }
  touch.on(this.$('li'),'hold',function(ev){
    ev.preventDefault();
    ev.stopPropagation();
    var msg = Messages.findOne({_id: data._id});
    console.log('hold event:', msg);
    if (!msg)
      return;

    if (msg.form.id === page_data.sender.id && (msg.send_status === 'failed' || msg.send_status === 'sending')){
      switch(msg.send_status){
        case 'failed':
          window.plugins.actionsheet.show({
            title: '消息发送失败，请选择？',
            buttonLabels: ['重新发送', '删除'],
            addCancelButtonWithLabel: '返回',
            androidEnableCancelButton: true
          }, function(index){
            if (index === 1)
              sendMqttMsg(msg);
            else if (index === 2)
              Messages.remove({_id: msg._id});
          });
          break;
        case 'sending':
          window.plugins.actionsheet.show({
            title: '消息发送中，请选择？',
            buttonLabels: ['取消发送'],
            addCancelButtonWithLabel: '返回',
            androidEnableCancelButton: true
          }, function(index){
            if (index === 1)
              Messages.remove({_id: msg._id});
          });
          break;
      }
    } else if(msg.to && !msg.to.isPostAbstract){
      // 复制文本
      window.plugins.actionsheet.show({
        title:'复制文本~',
        buttonLabels: ['复制文本'],
        addCancelButtonWithLabel: '取消',
        androidEnableCancelButton: true
      }, function(index){
        if(index === 1){
          cordova.plugins.clipboard.copy(msg.text,function(){
            PUB.toast('文本已复制');
          },function(){
            PUB.toast('复制失败');
          })
        }
      })
    }
  });
});
// Template._simpleChatToChatItem.onDestroyed(function(){
//   if(this.data.send_status === 'sending' && this.data.form.id === Meteor.userId())
//     Messages.update({_id: this.data._id}, {$set: {send_status: 'failed'}});
//     // sendMqttMsg(this.data);
// });

Template._simpleChatToChatItemText.onRendered(function(){
  this.$('a').click(function(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    console.log('_simpleChatToChatItemText onrenderd');
    handleAddedLink(e.currentTarget.href);
    return false;
  });
});
Template._simpleChatToChatItemText.helpers({
  convertLink: function(str){
    var html = str.convertLink("_blank");
    // html = EMOJI.parseShortNAME(html);
    return html;
  }
});

Template._simpleChatToChatItemText.events({
  'click a': function(e, t){
    console.log('_simpleChatToChatItemText events')
    handleAddedLink(e.currentTarget.href);
  }
});

Template._simpleChatToChatItem.helpers({
  convertLink: function(str){
    var html = str.convertLink("_blank");
    // html = EMOJI.parseShortNAME(html);
    return html;
  },
  format_pcomment:function(pcomment){
    if (pcomment != null && pcomment != undefined) {
        return pcomment.replace(/<(?:.|\n)*?>|[&nbsp;]/gm, '');
    } else {
        return pcomment;
    }
  },
  formatPIndex:function(index){
    if(index == 0){
      return '1'
    }
    return index
  },
  postAbstractStyle:function(to){
    if(to.isThumbsUp){
      return 'schat_post_abstract_up'
    }
    if(to.isThumbsDown){
      return 'schat_post_abstract_down'
    }
    if(to.isLinkText){
      return 'schat_post_abstract_link_text'
    }
    return ''
  },
  postAbstractIconStyle:function(to){
    if(to.isThumbsUp){
      return 'schat_post_abstract_up_icon'
    }
    if(to.isThumbsDown){
      return 'schat_post_abstract_down_icon'
    }
    if(to.isPcomments){
      return 'schat_post_abstract_icon'
    }
    if(to.isLinkText){
      return 'schat_post_abstract_linkText'
    }
  },
  isMoreThanHundredChar: function(text){
    if (text.length > 50)
      return text.substring(0,50) + "...";
    else
      return text;
  },
  is_error: function(images){
    for(var i=0;i<images.length;i++){
      if (images[i].error)
        return true;
    }
    return false;
  },
  is_remove: function(images){
    for(var i=0;i<images.length;i++){
      if (images[i].remove)
        return true;
    }
    return false;
  },
  is_label: function(images){
    for(var i=0;i<images.length;i++){
      if (images[i].label)
        return true;
    }
    return false;
  },
  is_remove_label: function(images){
    for(var i=0;i<images.length;i++){
      if (images[i].remove || images[i].label)
        return true;
    }
    return false;
  },
  is_wait_img: function(images){
    for(var i=0;i<images.length;i++){
      if (!images[i].remove && !images[i].label && !images[i].error)
        return true;
    }
    return false;
  },
  is_wait_item: function(item){
    return !item.remove && !item.label && !item.error;
  },
  ta_me: function(id){
    var sender = Session.get('msgFormUser');
    if (sender && sender.id ) {
      return id != sender.id ? 'ta' : 'me';
    }
    return id != Meteor.userId() ? 'ta' : 'me';
  },
  is_me: function(id){
    var sender = Session.get('msgFormUser');
    if (sender && sender.id ) {
      return id === sender.id;
    }
    return id === Meteor.userId();
  },
  is_associated:function(id){
    var sender = Session.get('msgFormUser');
    if (sender && sender.id ) {
      if (id === sender.id && id !== Meteor.userId()) {
        return true;
      }
    }
    return false;
  },
  status_sending: function(val){
    return val === 'sending';
  },
  status_failed: function(val){
    return val === 'failed';
  },
  show_images: function(images){
    var $li = $('li#' + this._id);
    var $imgs = $li.find('.text .imgs');
    var $labels = $li.find('.text .imgs-1-item');
    var is_scroll = false;

    $imgs.scrollTop(10);
    if ($imgs.scrollTop() > 0){is_scroll = true;$imgs.scrollTop(0);}
    $labels.each(function(){
      $(this).scrollTop(10);
      if ($(this).scrollTop() > 0){is_scroll = true;$(this).scrollTop(0);}
    });

    if (is_scroll)
      $li.find('.show_more').show();
  },
  is_show_time: function(id){
    try{
      var data = list_data.get();
      return data[_.pluck(data, '_id').indexOf(id)].show_time;
    }catch(ex){return false;}
  },
  get_time: function(id){
    var data = list_data.get();
    return data[_.pluck(data, '_id').indexOf(id)].show_time_str;
  },
  withEnableHaveReadMsg: function(){
    return withEnableHaveReadMsg;
  }
});

window.___message = {
  insert: function(id, filename, uri){
    var data = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0]));
    console.log()
    var to = toUsers[page_data.type+'.'+page_data.id];
    if (!to || !to.name){
      PUB.toast('正在加载数据，请稍后发送！');
      return false;
    }
    to.id = page_data.id;

    // if(data.type === 'group'){
    //   var obj = Groups.findOne({_id: data.id});
    //   to = {
    //     id: data.id,
    //     name: obj.name,
    //     icon: obj.icon
    //   };
    // }else{
    //   var obj = Meteor.users.findOne({_id: data.id});
    //   to = {
    //     id: data.id,
    //     name: AppConfig.get_user_name(obj),
    //     icon: AppConfig.get_user_icon(obj)
    //   };
    // }

    Messages.insert({
      _id: id,
      form:page_data.sender,
      to: to,
      to_type: data.type,
      type: 'image',
      images:[
        {
          _id: new Mongo.ObjectID()._str,
          id:'',
          url:null,
          label:null,
          people_his_id:id,
          thumbnail: '/packages/feiwu_simple-chat/images/sendingBmp.gif',
          filename: filename,
          uri: uri
        }
      ],
      //thumbnail: '/packages/feiwu_simple-chat/images/sendingBmp.gif',
      create_time: new Date(Date.now() + MQTT_TIME_DIFF),
      people_uuid:'',
      people_his_id:id,
      wait_lable:true,
      is_read: false,
      send_status: 'sending'
    }, function(err, id){
      console.log('insert id:', id);
      $('.box').scrollTop($('.box ul').height());
    });
  },
  update: function(id, url){
    var msg = Messages.findOne({_id: id});
    var images = msg.images;
    for (var i = 0; i < images.length; i++) {
      images[i].url = url;
    }
    Messages.update({_id: id}, {$set: {
      images: images
    }}, function(){
      console.log('update id:', id);
      $('.box').scrollTop($('.box ul').height());
      sendMqttMsg(msg);
    //   if (msg.to_type === 'group'){
    //     sendMqttGroupMessage(msg.to.id, Messages.findOne({_id: id}));
    //   }
    //   else{
    //     sendMqttUserMessage(msg.to.id, Messages.findOne({_id: id}),function(err){
    //       if(err){
    //         console.log('Cant send this message')
    //       } else {
    //         console.log('Sent to server')
    //       }
    //     });
    //   }
    });
  },
  remove: function(id){
    Messages.remove({_id: id}, function(){
      console.log('remove id:', id);
      $('.box').scrollTop($('.box ul').height());
    });
  }
};
window.___messageAudio = {
  insert: function(id, filename, uri,index){
    var data = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0]));
    console.log('simple-chat data:');
    console.log(data);
    var to = toUsers[page_data.type+'.'+page_data.id];
    if (!to || !to.name){
      PUB.toast('正在加载数据，请稍后发送！');
      return false;
    }
    to.id = page_data.id;

    Messages.insert({
      _id: id,
      form:page_data.sender,
      to: to,
      to_type: data.type,
      type: 'audio',
      audios:[
        {
          _id: new Mongo.ObjectID()._str,
          id:index,
          url:null,
          label:null,
          people_his_id:id,
          thumbnail: '/packages/feiwu_simple-chat/images/sendingBmp.gif',
          filename: filename,
          uri: uri
        }
      ],
      //thumbnail: '/packages/feiwu_simple-chat/images/sendingBmp.gif',
      create_time: new Date(Date.now() + MQTT_TIME_DIFF),
      people_uuid:'',
      people_his_id:id,
      wait_lable:true,
      is_read: false,
      send_status: 'sending'
    }, function(err, id){
      console.log('insert id:', id);
      $('.box').scrollTop($('.box ul').height());
    });
  },
  update: function(id, url,index){
    var msg = Messages.findOne({_id: id});
    var audios = msg.audios;
    for (var i = 0; i < audios.length; i++) {
      audios[i].url = url;
    }
    Messages.update({_id: id}, {$set: {
      audios: audios
    }}, function(){
      console.log('语音在oss的url更新');
      console.log('update id:', id);
      $('.box').scrollTop($('.box ul').height());
      //把语音消息 发送 mqtt消息
      sendMqttMsg(msg);
    //   if (msg.to_type === 'group'){
    //     sendMqttGroupMessage(msg.to.id, Messages.findOne({_id: id}));
    //   }
    //   else{
    //     sendMqttUserMessage(msg.to.id, Messages.findOne({_id: id}),function(err){
    //       if(err){
    //         console.log('Cant send this message')
    //       } else {
    //         console.log('Sent to server')
    //       }
    //     });
    //   }
    });
  },
  remove: function(id){
    Messages.remove({_id: id}, function(){
      console.log('remove id:', id);
      $('.box').scrollTop($('.box ul').height());
    });
  }
};
var clearMsgForGroundDB = function(){
  var msg = Messages.findArrySortBy_Id({}, {}, true);
  if (msg.length < 10)
    return

  for (var i = 0; i < 10; i++) {
    Messages.remove({_id:msg[i]._id});
  }
}

var clearMsgForGroundDB2 = function(maxcount){
  var msg = Messages.findArrySortBy_Id({}, {}, true);
  function removeGroundDBById(id) {
    Meteor.setTimeout(function(){
      Messages.remove({_id: id});
    }, 0);
  }
  for (var i = 0; i < msg.length - GroundDBCleanThreshold; i++) {
    removeGroundDBById(msg[i]._id)
  }
}

function clearOldMessageIfLocalStorageIsNotEngough() {
  //本地只保留9999条消息
  clearMsgForGroundDB2(9999)

  quota = localStorage.getItem('LocalStorageQuota')
  if (!quota) {
    return ;
  }
  used = getLocalStorageUsedSize();
  console.log("used="+used+", quota="+quota);
  if (parseFloat(used) > parseFloat(quota)*0.85) {
    console.log("used > (quota*0.85), clean up messages");
    clearMsgForGroundDB();
    clearMsgLastTime = new Date().getTime();
  }
}
SimpleChat.onMqttMessage = function(topic, msg) {
  var insertMsg = function(msgObj, type){
    console.log(type, msgObj._id);

    // 聊天窗口判断是否自动滚动
    var auto_to_bottom = false;
    if (location.pathname === '/simple-chat/to/user' || location.pathname === '/simple-chat/to/group' && list_data && list_data.id === msgObj.to.id){
      var $box = $('.simple-chat > .msg-box .box');
      var box_height = $box.scrollTop()+$box.height();
      var ul_height = $box.find('ul.group-list').height();
      console.log('是否在低部:', box_height, ul_height);
      if (box_height >= ul_height)
        auto_to_bottom = true;
    }

    Messages.insert(msgObj, function(err, _id){
      if (err)
        return console.log('insert msg error:', err);
      if (auto_to_bottom === true){
        setTimeout(scrollToBottom, 800);
        // Meteor.setTimeout(function(){
        //   $('.box').scrollTop($('.box ul').height());
        //   console.log('==聊天自动滚动==');
        // }, 600);
      }
    });
  };

  if (!(topic.startsWith('/t/msg/g/') || topic.startsWith('/t/msg/u/')))
    return;

  var msgObj = JSON.parse(msg);
  // var whereTime = new Date(format_date(new Date(), 'yyyy-MM-dd 00:00:00'));
  // var msgType = topic.split('/')[2];
  // var where = {
  //   to_type: msgObj.to_type,
  //   wait_lable: msgObj.wait_lable,
  //   label_complete: {$ne: true},
  //   'to.id': msgObj.to.id,
  //   images: {$exists: true},
  //   create_time: {$gte: whereTime},
  //   type: 'text'
  // };

  if (msgObj.to_type === 'user') {
    if (msgObj.type === 'haveReadMsg') {
      Messages.find({'form.id':msgObj.to.id,'to.id':msgObj.form.id,is_read:false}).forEach(function(item){
          Messages.update({_id:item._id},{$set:{is_read:true}});
      })
      return;
    }
    //ta 被我拉黑
    if(BlackList.find({blackBy: msgObj.to.id, blacker:{$in: [msgObj.form.id]}}).count() > 0){
      console.log(msgObj.to.id+'被'+msgObj.to.id+'拉黑');
      return;
    }
  }

  msgObj.create_time = msgObj.create_time ? new Date(msgObj.create_time) : new Date();
  // if (msgObj.images && msgObj.length > 0 && msgObj.is_people && msgObj.people_id){
  //   for(var i=0;i<msgObj.images.length;i++)
  //     msgObj.images[i].id = msgObj.people_id;
  // }

  if (Messages.find({_id: msgObj._id}).count() > 0)
    return console.log('已存在此消息:', msgObj._id);
  //if (Messages.find({notifyId: msgObj.notifyId}).count() > 0)
  //  return console.log('已存在此通知消息:', msgObj.notifyId);

  // if (msgObj.wait_lable){where.people_uuid = msgObj.people_uuid}
  // else if (!msgObj.wait_lable && msgObj.images && msgObj.images.length > 0) {where['images.label'] = msgObj.images[0].label}
  // else {return insertMsg(msgObj)}
  // // else {return Messages.insert(msgObj)}

  // console.log('SimpleChat.SimpleChat where:', where);
  // var targetMsg = Messages.findOne(where, {sort: {create_time: -1}});

  // if (!targetMsg || !targetMsg.images || targetMsg.images.length <= 0)
  //   return insertMsg(msgObj, '无需合并消息');
  // if (!msgObj.images || msgObj.images.length <= 0)
  //   return insertMsg(msgObj, '不是图片消息');
  // if (msgObj.to_type != 'group' || !msgObj.is_people)
  //   return insertMsg(msgObj, '不是 Group 或人脸消息');

  // var setObj = {create_time: new Date(), 'form.name': msgObj.form.name};
  // if (msgObj.wait_lable){
  //   var count = 0;
  //   for(var i=0;i<targetMsg.images.length;i++){
  //     if (!targetMsg.images[i].label && !targetMsg.images[i].remove && !targetMsg.images[i].error)
  //       count += 1;
  //   }
  //   for(var i=0;i<msgObj.images.length;i++){
  //     if (!msgObj.images[i].label && !msgObj.images[i].remove && !msgObj.images[i].error)
  //       count += 1;
  //   }
  //   if (count > 0)
  //     setObj.text = count + ' 张照片需要标注';
  // } else {
  //   setObj.text = msgObj.images[0].label + ' 加入了聊天室';
  // }

  // Messages.update({_id: targetMsg._id}, {
  //   $set: setObj,
  //   $push: {images: {$each: msgObj.images}}
  // }, function(err, num){
  //   if (err || num <= 0)
  //     insertMsg(msgObj, 'update 失败');
  // });
  insertMsg(msgObj);
  clearOldMessageIfLocalStorageIsNotEngough();
};

// SimpleChat.onMqttMessage('/t/msg/g/b82cc56c599e4c143442c6d0', JSON.stringify({
//   "_id":new Mongo.ObjectID()._str,
//   "form":{"id":"u5DuPhJYW5raAQYuh","name":"7YRBBDB722002717","icon":"/userPicture.png"},
//   "to":{"id":"b82cc56c599e4c143442c6d0","name":"群聊 2","icon":""},
//   "images":[{"_id":new Mongo.ObjectID()._str,"id":"17","people_his_id":"56rqonm3FNssmh6cR","url":"http://onm4mnb4w.bkt.clouddn.com/eb2a15d6-2310-11e7-9ce5-d065caa81a04","label":null}],
//   "to_type":"group",
//   "type":"text",
//   "text":"[设备 4,17]: -> 需要标注",
//   "create_time": new Date(),
//   "people_id":"17",
//   "people_uuid":"7YRBBDB722002717",
//   "people_his_id":"56rqonm3FNssmh6cR",
//   "wait_lable":true,
//   "is_people":true,
//   "is_read":false
// });

last_msg = null;
// SimpleChat.onMqttMessage = function(topic, msg) {
//   console.log('SimpleChat.onMqttMessage, topic: ' + topic + ', msg: ' + msg);
//   var group = topic.substring(topic.lastIndexOf('/') + 1);
//   var msgObj = JSON.parse(msg);
//   //var last_msg = Messages.findOne({}, {sort: {create_time: -1}});
//   if(msgObj.form.id === Meteor.userId()){
//     return;
//   }
//   if(last_msg && last_msg._id === msgObj._id){
//     return;
//   }
//   last_msg = msgObj;

//   if(Messages.find({_id: msgObj._id}).count() > 0){
//     // 自己发送的消息且本地已经存在
//     //if (msgObj && msgObj.form.id === Meteor.userId())
//     //  return;

//     //msgObj._id = new Mongo.ObjectID()._str;
//     return
//   }

//   try{
//     console.log('last_msg:', last_msg);
//     msgObj.create_time = msgObj.create_time ? new Date(msgObj.create_time) : new Date();
//     var group_msg = last_msg && msgObj && msgObj.to_type === 'group' && msgObj.to.id === last_msg.to.id; // 当前组消息
//     if (!group_msg)
//       return Messages.insert(msgObj);

//     if (last_msg && last_msg.is_people === true && last_msg.images && last_msg.images.length > 0 && msgObj.images && msgObj.images.length > 0){
//       if(!msgObj.wait_lable && msgObj.images[0].label === last_msg.images[0].label){
//         Messages.update({_id: last_msg._id}, {
//           $set: {create_time: msgObj.create_time},
//           $push: {images: msgObj.images[0]}
//         }, function(err, num){
//           if (err || num <= 0)
//             Messages.insert(msgObj);
//         });
//       }else if(msgObj.wait_lable && msgObj.people_id === last_msg.people_id && msgObj.people_uuid === last_msg.people_uuid){
//         Messages.update({_id: last_msg._id}, {
//           $set: {create_time: msgObj.create_time},
//           $push: {images: msgObj.images[0]}
//         }, function(err, num){
//           if (err || num <= 0)
//             Messages.insert(msgObj);
//         });
//       }else{
//         Messages.insert(msgObj);
//       }
//     }else{
//       Messages.insert(msgObj);
//     }
//   }catch(ex){
//     console.log(ex);
//     Messages.insert(msgObj);
//   }
// };


// label
var label_view = null;
var label_limit = new ReactiveVar(0);
show_label = function(callback){
  if (label_view)
    Blaze.remove(label_view);
  label_view = Blaze.renderWithData(Template._simpleChatToChatLabelName, {
    callback : callback || function(){}
  }, document.body)
}

Template._simpleChatToChatLabelName.onRendered(function(){
  label_limit.set(40);
  Meteor.subscribe('get-label-names', label_limit.get()); // TODO：
});
Template._simpleChatToChatLabelName.helpers({
  names: function(){
    return PersonNames.find({}, {sort: {createAt: 1}, limit: label_limit.get()});
  }
});
Template._simpleChatToChatLabelName.events({
  'click li': function(e, t){
    $('#label-input-name').val(this.name);
    t.$('li img').removeAttr('style');
    $(e.currentTarget).find('img').attr('style', 'border: 1px solid #39a8fe;');
  },
  'click .leftButton': function(){
    Blaze.remove(label_view);
    label_view = null;
  },
  'click .rightButton': function(e, t){
    if (!$('#label-input-name').val())
      return PUB.toast('请选择或输入名字~');;

    t.data.callback && t.data.callback($('#label-input-name').val());
    Blaze.remove(label_view);
    label_view = null;
  }
});

// remove
var remove_view = null;
show_remove = function(callback){
  if (remove_view)
    Blaze.remove(remove_view);
  remove_view = Blaze.renderWithData(Template._simpleChatToChatLabelRemove, {
    callback : callback || function(){}
  }, document.body)
}

Template._simpleChatToChatLabelRemove.events({
  'click li': function(e, t){
    $('#label-input-name').val($(e.currentTarget).find('.userName').text());
    // t.$('li img').removeAttr('style');
    // $(e.currentTarget).find('img').attr('style', 'border: 1px solid #39a8fe;');
  },
  'click .leftButton': function(){
    Blaze.remove(remove_view);
    remove_view = null;
  },
  'click .rightButton': function(e, t){
    if (!$('#label-input-name').val())
      return PUB.toast('请输入删除照片的原因~');;

    t.data.callback && t.data.callback($('#label-input-name').val());
    Blaze.remove(remove_view);
    remove_view = null;
  }
});

Template._simpleChatListLayout.events({
  'click .delBtnContent': function(e,t){
    e.stopImmediatePropagation();
    var _id = e.currentTarget.id;
    var type = $(e.currentTarget).data('type');
    var userId = Meteor.userId();
    var toUserId = $(e.currentTarget).data('touserid');
    $(e.target).parents('li').slideUp('fast',function () {
      $(e.target).parent('li').remove();
      // remove current list
      SimpleChat.MsgSession.remove({_id: _id},function(err,num){
        if(err){
          return console.log('del MsgSession Err:',err);
        }
        console.log('num =',num)
        // remove local msg with this Session
        if(type == 'group'){
          toUserId = toUserId.slice(0,toUserId.lastIndexOf('_group'));
        }
        SimpleChat.Messages.remove({'to.id': toUserId,'form.id': userId});
        SimpleChat.Messages.remove({'to.id': userId,'form.id': toUserId});
      });
    });
  },
  'click li': function(e, t){
    var _id = e.currentTarget.id;
    var history = Session.get('history_view') || [];
    history.push({
      view: 'simple-chat/user-list/'+Meteor.userId(),
      scrollTop: document.body.scrollTop
    });

    var msgid = $(e.currentTarget).attr('msgid')
    MsgSession.update({'_id':msgid},{$set:{count:0}})
    var roomtitle = $('#' + _id + ' h2').html()
    console.log('this to user name is ' + roomtitle);
    Session.set('msgToUserName', roomtitle);
    var from = {
      id:this.userId,
      name:this.userName,
      icon:this.userIcon
    }
    Session.set('msgFormUser',from);

    Session.set("history_view", history);
    if(this.sessionType === 'group'){
      Session.set('groupsId', _id)
      Router.go(AppConfig.path + '/to/group?id='+_id+'&name='+encodeURIComponent(this.toUserName)+'&icon='+encodeURIComponent(this.toUserIcon));
    } else {
      Router.go(AppConfig.path + '/to/user?id='+_id+'&name='+encodeURIComponent(this.toUserName)+'&icon='+encodeURIComponent(this.toUserIcon));
    }
  },
  'click .writeMeaaage': function(e,t){
    // TODO
    console.log('写私信');
    history = Session.get('history_view') || [];
    history.push({
      view: 'simple-chat/user-list/'+Meteor.userId(),
      scrollTop: document.body.scrollTop
    });
    Session.set('history_view',history);
    Router.go('/write-letter');
  },
  'click #follow': function(){
    history = Session.get('history_view') || [];
    history.push({
      view: 'simple-chat/user-list/'+Meteor.userId(),
      scrollTop: document.body.scrollTop
    });
    Session.set('history_view',history);
    Router.go('/searchFollow');
  }
});
Template._groupMessageList.onRendered(function(){
  Session.set('msgSessionLimit',40);
  var medialistHeight = 0;
  $('.container-box').scroll(function(){
    var height = $('.simple-chat-medialist').height();
    var contentTop = $('.container-box').scrollTop();
    var contentHeight = $('.container-box').height();
    console.log(contentTop+contentHeight)
    console.log(height)
    var is_loading_more = false;

    if((contentHeight + contentTop + 50 ) >= height && !is_loading_more){
      // if (height === medialistHeight) {
      //   return;
      // }
      var limit = Session.get('msgSessionLimit') + 20;
      Session.set('msgSessionLimit', limit);
      console.log('loadMore and limit = ',limit);
      is_loading_more = true;
      SyncMsgSessionFromServer(Meteor.userId(), true, function(){
        is_loading_more = false;
        // medialistHeight = $('.simple-chat-medialist').height();
      });
      // Meteor.subscribe('device-timeline-with-hour',limit,{onStop:function(){
      //   is_loading_more = false;
      //   medialistHeight = $('.simple-chat-medialist').height();

      // },onReady:function(){
      //   is_loading_more = false;
      //   medialistHeight = $('.simple-chat-medialist').height();
      // }});
    }
  });
});

Template._groupMessageList.helpers({
  limit_top_read_count: function(count) {
    return count >= 99;
  },
  notReadCountPcomment: function() {
    var typeArr;
    typeArr = ["pcomment", "pcommentReply", "pfavourite", "pcommentowner", "getrequest", "sendrequest", "recommand", "recomment", "comment"];
    return Feeds.find({
      followby: Meteor.userId(),
      isRead: {
        $ne: true
      },
      checked: {
        $ne: true
      },
      eventType: {
        "$in": typeArr
      },
      createdAt: {
        $gt: new Date((new Date()).getTime() - 7 * 24 * 3600 * 1000)
      }
    }, {
      limit: 99
    }).count();
  },
  is_wait_read_count: function(count){
    return count > 0;
  },
  formatTime: function(val){
    return get_diff_time(val);
  },
  is_associated:function(userId){
    if (userId === Meteor.userId()) {
      return false;
    }
    return true;
  }
});

Template._groupMessageList.events({
  'click .bell-line': function(e) {
    var currentType;
    currentType = e.currentTarget.id;
    Session.set('bellType', currentType);
    return Router.go('/bellcontent');
  }
  // 'click li': function(e){
  //   msgid = $(e.currentTarget).attr('msgid')
  //   MsgSession.update({'_id':msgid},{$set:{count:0}})
  //   console.log('this to user name is ' + this.toUserName);
  //   Session.set('msgToUserName', this.toUserName);
  //   var from = {
  //     id:this.userId,
  //     name:this.userName,
  //     icon:this.userIcon
  //   }
  //   Session.set('msgFormUser',from);
  //   console.log('url', AppConfig.path+'/to/'+this.sessionType+'?id='+e.currentTarget.id);
  //   return Router.go(AppConfig.path+'/to/'+this.sessionType+'?id='+e.currentTarget.id);
  // }
})

// ===== 处理输入框 ===============
var hasInputing = new ReactiveVar(false);
var hasFooterView = new ReactiveVar(false);
var footerView = new ReactiveVar('');
var renderFootBody = function(){
  // var $foot = $('.msg-box .footer');
  // var $body = $('.msg-box .box');
  // $body.css({
  //   'bottom': $foot[0].clientHeight + 'px'
  // });
};

var scrollToBottomThrottle = new throttleClass(100, 500);
var scrollToBottom = function(){
  scrollToBottomThrottle.run(function(){
    if (!$chat_box)
      $chat_box = $('.msg-box .box');
    // $chat_box.smoothScroll('+=' + $chat_box.scrollHeight);
    $chat_box.scrollTop($chat_box[0].scrollHeight);
  });
};

Template._simpleChatToChatLayout.onRendered(function(){
  hasInputing.set(false);
  hasFooterView.set(false);
  footerView.set('');
});
Template._simpleChatToChatLayout.onDestroyed(function(){
  hasInputing.set(false);
  hasFooterView.set(false);
  footerView.set('');
});

function jsSoftKeyboardEnterClicked() {
  console.log('##RDBG jsSoftKeyboardEnterClicked');
  $('.from-submit-btn').click();
}
var resizeTime = null;
Template._simpleChatToChatLayout.events({
  'keyup #simple-chat-text': function(e){
    console.log('keyup value is ' + e.currentTarget.value);
    console.log('keyup code is ' + e.keyCode);
    hasInputing.set(e.currentTarget.value ? true : false);
    if ($(e.currentTarget).height() > 38) {
      $(e.currentTarget).css('line-height', '20px');
    } else {
      $(e.currentTarget).css('line-height', '26px');
    }
    var str = e.currentTarget.value;
    var lastStr = str.charAt(str.length - 1);
    var isGroups = Blaze.getData(Blaze.getView(document.getElementsByClassName('simple-chat')[0])).is_group();
    var notDelKey = true;
    var keyuptextlength = $('#simple-chat-text').val().length;
    if(keyuptextlength < Session.get('keydowntextlength')){
      notDelKey = false;
    }
    if(lastStr == '@' && notDelKey && isGroups){
      Session.set('simple-chat-text-val', $('.input-text').val());
      $('.input-text').blur();
      $(".thisGroupUsersList").slideDown('slow');
    }
    // setTimeout(scrollToBottom, 100);
  },
  'keydown #simple-chat-text': function(e){
    Session.set('keydowntextlength', $('#simple-chat-text').val().length)
  },
  'keypress #simple-chat-text': function(e){
    if (e.keyCode == 13) {
      e.preventDefault();
      e.stopPropagation();
      $('.from-submit-btn').click();
    }
  },
  'focus #simple-chat-text': function(e){
    hasInputing.set(e.currentTarget.value ? true : false);
    hasFooterView.set(false);
    footerView.set('');
    setTimeout(scrollToBottom, 1000);
  },
  'blur #simple-chat-text': function(e){
    hasInputing.set(e.currentTarget.value ? true : false);
    // setTimeout(scrollToBottom, 100);
  },
  'click .from-submit-btn': function(e ,t){
    console.log('click .from-submit-btn');
    if($('.new-other-box').length === 0){
      $('.input-text').focus();
    }
    if ($('.input-text').val() && $('.new-other-box').length === 0){
      var $body = $('.msg-box .box');
      // $body.css({
      //   'bottom': '48px'
      // });
      hasFooterView.set(false);
      hasInputing.set(false);
      setTimeout(scrollToBottom, 800);
    }
    var textval = $('.input-text').val();
    setTimeout(function(){
      try{
        var data = t.data;
        var text = $('.input-text').val();
        var to = toUsers[data.type+'.'+data.id];
        if (!to || !to.name){
          to = {
            name: data.name,
            icon: data.icon
          };
        }
        to.id = data.id;
        console.log('发送消息给:', to);

        if(!text){
          $('.box').scrollTop($('.box ul').height());
          return false;
        }
        var msg = {
          _id: new Mongo.ObjectID()._str,
          form:page_data.sender,
          to: to,
          to_type: data.type,
          type: 'text',
          text: text,
          create_time: new Date(Date.now() + MQTT_TIME_DIFF),
          is_read: false,
          send_status: 'sending'
        };
        console.log('send msg:', msg);
        Messages.insert(msg, function(){
          console.log('send message...');
          sendMqttMsg(msg);
          setTimeout(scrollToBottom, 100);
        });
        trackEvent("socialBar","AuthorReply")
        hasInputing.set(false);
        autosize.update($('#simple-chat-text'));
        setTimeout(scrollToBottom, 100);
        var $text = $('#simple-chat-text');
        $('.input-text').val('');
        if ($text.length > 0 && $text.get(0) && $text.get(0).updateAutogrow)
          $text.get(0).updateAutogrow();
        return false;
      }catch(ex){console.log(ex); return false;}
    }, 50);
    var thisUserName = Meteor.user().profile && Meteor.user().profile.fullname ? Meteor.user().profile.fullname : Meteor.user().username;
    if(Session.get('pushNotiUsers') != undefined && Session.get('pushNotiUsers').length > 0){
      var userArr = Session.get('pushNotiUsers');
      var sendMsg = thisUserName + '在群聊中@了你'
      userArr.forEach(function(item){
        var sendUser = textval.indexOf('@' + item.name);
        if(sendUser > -1){
          var doc = {
            _id: new Mongo.ObjectID()._str,
            type:'sendOnePushNotification',
            userId: Meteor.userId(),
            toUserId: item.id,
            content: sendMsg
          }
          Meteor.call('sendOneUserPushNotification',doc)
        }
    });
    }
    return false;
  },
  'click .from-smile-btn': function(){
    console.log('click .from-smile-btn');
    footerView.set('__simpleChatToChatFooterIcons');
    hasFooterView.set(true);
    setTimeout(scrollToBottom, 800);
  },
  'click .from-other-btn': function(){
    $('textarea').show();
    $('.f3').hide();
    console.log('click .from-other-btn');
    footerView.set('__simpleChatToChatFooterTools');
    hasFooterView.set(true);
    setTimeout(scrollToBottom, 800);
  },
  'click .msg-box .box': function(){
    footerView.set('');
    hasInputing.set(false);
    hasFooterView.set(false);
    setTimeout(scrollToBottom, 800);
  },
  'click ul.new-icons li':function(e){
    var inputText = $('#simple-chat-text').val();
    inputText += $(e.currentTarget).text();
    $('#simple-chat-text').val(inputText);
    autosize.update($('#simple-chat-text'));
    if ($('#simple-chat-text').height() > 38) {
      $('#simple-chat-text').css('line-height', '20px');
    } else {
      $('#simple-chat-text').css('line-height', '26px');
    }
    hasInputing.set(true);
    console.log(emoji_shortname);
  },
  'click .new-btn-photo': function(){
    footerView.set('');
    hasFooterView.set(false);
    setTimeout(scrollToBottom, 800);

    selectMediaFromAblum(9, function(cancel, res,currentCount,totalCount){
      if (cancel || !res)
        return;

        var id = new Mongo.ObjectID()._str;
        var timestamp = new Date().getTime();
        var filename = Meteor.userId()+'_'+timestamp+'.jpg';
        window.___message.insert(id, res.filename, res.URI);
        window.uploadToAliyun_new(filename, res.URI, function(status, result){
          console.log("result:"+result,"status:"+status)

          if (status === 'done' && result){
            window.___message.update(id, result);
            setTimeout(scrollToBottom, 100);
          }
        });
    });
  },
  'click .new-btn-camera': function(){
    footerView.set('');
    hasFooterView.set(false);
    setTimeout(scrollToBottom, 800);

    window.takePhoto(function(res){
      if (res){
        var id = new Mongo.ObjectID()._str;
        var timestamp = new Date().getTime();
        var filename = Meteor.userId()+'_'+timestamp+'.jpg';

        window.___message.insert(id, res.filename, res.URI);
        window.uploadToAliyun_new(filename, res.URI, function(status, result){
          if (status === 'done' && result){
            window.___message.update(id, result);
            setTimeout(scrollToBottom, 100);
          }
        });
      }
    });
  }
});
Template._simpleChatGroupUsersList.events({
  'click .groupUsersListCancle': function(e){
    $(".thisGroupUsersList").slideUp();
    Meteor.setTimeout(function(){
      $('.input-text').focus();
    }, 100);
  },
  'click .eachGroupUser': function(e){
    var username = $(e.currentTarget).attr('username');
    var userId = e.currentTarget.id;
    var userData = {
      id: userId,
      name: username
    }
    var userArr = [];
    if(Session.get('pushNotiUsers')){
      userArr = Session.get('pushNotiUsers');
    }
    userArr.push(userData)
    Session.set('pushNotiUsers',userArr);
    $(".thisGroupUsersList").slideUp('slow');
    $('.input-text').val(Session.get('simple-chat-text-val') + username + ' ');
    Meteor.setTimeout(function(){
      $('#simple-chat-text').select();
    }, 100);
  }
});
Template._simpleChatToChatLayout.helpers({
  withVoiceMessage: function(){
    return withVoiceMessage;
  },
  getInputClass: function(){
    return hasInputing.get() ? 'inputing' : '';
  },
  hasInputing: function(){
    return hasInputing.get();
  },
  hasFooterView: function(){
    return hasFooterView.get();
  },
  footerView: function(){
    return footerView.get();
  },
  formatChatTime: function(time){
    return formatChatTime(time);
  },
  timeStyles: function(){
    var result = '.my-new-time{text-align: center;}';
    result += '.my-new-time span{background-color: #ccc; color: #fff; font-size: 12px; border-radius: 5px; padding: 3px 10px;}\r\n';
    timeStyles.get().map(function(item){
      result += item + '{display:none;}\r\n';
      result += item + ':nth-of-type(1){display:block;}\r\n';
    });
    return result;
  }
});
Template.__simpleChatToChatFooterIcons.helpers({
  emojis: function(){
    return EMOJI2.packages
  }
});
Template._simpleChatGroupUsersList.onRendered(function(){
  var groupid = Session.get('groupsId');
  var windowheight = $(window).height();
  $('.thisGroupUsersList #wrapper').css('min-height', windowheight + 'px');
  Meteor.subscribe("get-group-user",groupid);
});
Template._simpleChatGroupUsersList.helpers({
  groupUsers: function(str){
    console.log('groupUsersList ========== ' + SimpleChat.GroupUsers.find({group_id:Session.get('groupsId')},{sort: {createdAt: 1}}).count());
    return SimpleChat.GroupUsers.find({group_id:Session.get('groupsId')},{sort: {createdAt: 1}});
  }
});

Template._simpleChatToChatItem.helpers({
  formatChatTimeHtml: function(time){
    var styles = timeStyles.get();
    var timeRes = formatChatTime(time);

    if (!timeRes)
      return '';
    if (styles.indexOf('time_' + timeRes[0]) === -1)
      styles.push('time_' + timeRes[0]);

      timeStyles.set(styles);
    return '<time_'+timeRes[0]+' class="my-new-time"><span>'+timeRes[1].trim()+'</span></'+timeRes[0]+'>';
  }
});

var formatChatTime = function(time){
  if (!time || !time.format)
    return;

  var result = '';
  var now = new Date();

  // 当天
  if (time.format('yyyy-MM-dd') === now.format('yyyy-MM-dd'))
    return [time.format('hhmm'), time.format('hh:mm')];

  // 三天内
  if (now.getTime() - time.getTime() >= 1000*60*60*24*3)
  return [time.format('eehhmm'), time.format('ee hh:mm')];

  // 今年
  if (time.format('yyyy') === now.format('yyyy'))
    return [time.format('MMddhhmm'), time.format('MM-dd hh:mm')];

  return [time.format('yyyyMMddhhmm'), time.format('yyyy-MM-dd hh:mm')];
};
