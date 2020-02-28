FROM daocloud.io/library/ubuntu:16.04

RUN apt-get update && apt-get install -y wget git && apt-get clean
RUN wget http://www.cs.toronto.edu/~kriz/cifar-10-matlab.tar.gz
