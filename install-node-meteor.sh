#!/usr/bin/env bash

set -e

: ${SCRIPTS_PATH:?}

echo "Installing Meteor..."

# Override tar with bsdtar as a temporal fix for:
# https://github.com/docker/hub-feedback/issues/727

bash ${SCRIPTS_PATH}/tar-override.sh
bash ${SCRIPTS_PATH}/install_meteor.sh
bash ${SCRIPTS_PATH}/tar-restore.sh

echo "Installing Node..."
bash ${SCRIPTS_PATH}/nodejs_setup_8.x
apt-get install -y nodejs
npm install npm -g
