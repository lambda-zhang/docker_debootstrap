FROM ultralytics/yolov5:latest
RUN wget https://github.com/foamliu/Tacotron2-Mandarin/releases/download/v1.0/BEST_checkpoint.tar && wget https://github.com/foamliu/Tacotron2-Mandarin/releases/download/v1.0/tacotron2-cn.pt
