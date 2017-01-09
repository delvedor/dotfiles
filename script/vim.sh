#!/bin/sh

# go to home directory
cd

# create vim folder
mkdir .vim

# install vim and mac vim
brew install vim
brew install macvim

# simlink macvim version to vim
# ln -s /usr/local/bin/mvim vim

# install cmake
brew install cmake

# install pathogen
mkdir -p ~/.vim/autoload ~/.vim/bundle && \
curl -LSso ~/.vim/autoload/pathogen.vim https://tpo.pe/pathogen.vim

# go to plugins folder
cd ~/.vim/bundle

# install YouCompleteMe
git clone https://github.com/Valloric/YouCompleteMe.git
cd ~/.vim/bundle/YouCompleteMe
git submodule update --init --recursive
./install.py --clang-completer --tern-completer

# install syntastic
cd ~/.vim/bundle && \
git clone --depth=1 https://github.com/vim-syntastic/syntastic.git

# install one theme
cd ~/.vim/bundle
git clone https://github.com/rakr/vim-one.git

# install vim-airline
git clone https://github.com/vim-airline/vim-airline ~/.vim/bundle/vim-airline

# install vim-airline-themes
git clone https://github.com/vim-airline/vim-airline-themes ~/.vim/bundle/vim-airline-themes

# install nerdtree
git clone https://github.com/scrooloose/nerdtree.git ~/.vim/bundle/nerdtree

# install tern_for_vim
cd ~/.vim/bundle
git clone https://github.com/ternjs/tern_for_vim.git
cd tern_for_vim
npm i

# install vim-colors-solarized
cd ~/.vim/bundle
git clone git://github.com/altercation/vim-colors-solarized.git

# install vim-markdown
cd ~/.vim/bundle
git clone https://github.com/plasticboy/vim-markdown.git

# install vim-javascript
git clone https://github.com/pangloss/vim-javascript.git ~/.vim/bundle/vim-javascript

# install vim-devicons
git clone https://github.com/ryanoasis/vim-devicons ~/.vim/bundle/vim-devicons
echo "Go to https://github.com/ryanoasis/vim-devicons for complete the vim-devicons configuration"

echo ""
echo "Vim configured!"
