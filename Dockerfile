FROM daocloud.io/library/ubuntu:16.04
RUN apt-get update && apt-get install -y wget git && apt-get clean
RUN wget https://github.com/foamliu/Tacotron2-Mandarin/releases/download/v1.0/BEST_checkpoint.tar && wget https://github.com/foamliu/Tacotron2-Mandarin/releases/download/v1.0/tacotron2-cn.pt
