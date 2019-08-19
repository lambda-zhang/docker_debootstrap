AppConfig = {
  path: '/simple-chat',
  get_user_name: function(doc){
    return doc.profile && doc.profile.fullname ? doc.profile.fullname : doc.username
  },
  get_user_icon: function(doc){
    return doc.profile && doc.profile.icon ? doc.profile.icon : '/userPicture.png'
  },
  get_post_title: function(){
    var title = '聊天室'
    var post = Session.get('postContent');
    if (post)
      title += ':'+post.title;
    return title;
  },
  get_group_title: function(){
    var title = '群聊';
    if(Session.get('chat_group_title')){
      title = Session.get('chat_group_title');
    }
    return title;
  },
  upload_cordova_image: function(file, callback){}
};