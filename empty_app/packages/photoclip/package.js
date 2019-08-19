Package.describe({
  name: 'sraita:photoclip',
  version: '3.2.0',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});


Package.onUse(function(api) {
  api.addFiles([
    'iscroll-zoom.js', 'hammer.min.js',
    'lrz.all.bundle.js',
    'PhotoClip.js'
  ], 'client');
});
