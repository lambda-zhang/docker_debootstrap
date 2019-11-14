FROM daocloud.io/library/ubuntu:16.04

RUN apt-get update && apt-get install -y wget git && apt-get clean
RUN git clone https://github.com/opencv/opencv.git
RUN wget https://pjreddie.com/media/files/darknet53.conv.74
RUN wget https://github.com/lhelontra/tensorflow-on-arm/releases/download/v1.14.0-buster/tensorflow-1.14.0-cp37-none-linux_aarch64.whl
