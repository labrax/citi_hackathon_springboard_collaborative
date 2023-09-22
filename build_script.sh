#!/bin/bash

npm install -g yarn
yarn
yarn run build

mkdir -p uploads/users/
cp public/img/defaultProfile.jpg public/uploads/users/defaultProfile.jpg
