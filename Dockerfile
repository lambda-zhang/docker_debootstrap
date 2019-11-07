FROM daocloud.io/library/ubuntu:16.04

RUN apt-get update && apt-get install -y wget && apt-get clean
RUN wget https://github.com/lhelontra/tensorflow-on-arm/releases/download/v1.13.1/tensorflow-1.13.1-cp35-none-linux_aarch64.whl
