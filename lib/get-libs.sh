#!/bin/bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp || exit
make
./models/download-ggml-model.sh base