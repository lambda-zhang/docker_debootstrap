Router.route(AppConfig.path + '/guide/to/:type', {
  template: '_simpleChatToChatGuide',
  data: function(){
    return {
      type: this.params.type,
      id: this.params.query['id']
    }
  }
});

Template._simpleChatToChatGuide.onRendered(function(){
  Router.go('/simple-chat/to/'+this.data.type+'?id='+this.data.id);
});