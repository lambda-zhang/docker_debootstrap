FROM daocloud.io/library/ubuntu:16.04

RUN apt-get update && apt-get install -y wget git && apt-get clean
RUN git clone  https://github.com/lionsoul2014/ip2region
