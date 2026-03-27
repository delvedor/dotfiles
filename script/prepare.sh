#!/usr/bin/env bash

# Update system if we are on linux
if [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
  echo "Updating system"
  sudo apt-get update
  sudo apt-get upgrade
fi

# Configure git
echo "Configure git"
git config --global user.name "delvedor"
git config --global user.email "tommydelved@gmail.com"

# Clone dotfiles
echo "Cloning dotfiles"
git clone https://github.com/delvedor/dotfiles.git
cp dotfiles/.zshrc .
cp dotfiles/.tmux.conf .
mkdir .config
mkdir .config/nvim
cp dotfiles/init.vim .config/nvim
rm -rf dotfiles

# Install and configure zsh
echo "Installing zsh"
if [ "$(uname)" == "Darwin" ]; then
  brew install zsh
else
  sudo apt-get install zsh
fi
chsh -s $(which zsh)
source .zshrc

# Install and configure oh-my-zsh
echo "Installing oh-my-zsh"
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
source .zshrc

# Install and configure bat
echo "Installing bat"
if [ "$(uname)" == "Darwin" ]; then
  brew install bat
else
  curl -L https://github.com/sharkdp/bat/releases/download/v0.11.0/bat_0.11.0_amd64.deb --output bat.deb
  sudo dpkg -i bat.deb
  rm bat.deb
fi

# Install and configure tmux
echo "Installing tmux"
if [ "$(uname)" == "Darwin" ]; then
  brew install tmux
  brew install reattach-to-user-namespace
else
  sudo apt-get install tmux
fi

# Install tmux plugin manager
echo "Installing tmux plugin manager"
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
tmux source ~/.tmux.conf

# Install and configure neovim
echo "Installing neovim"
if [ "$(uname)" == "Darwin" ]; then
  brew install neovim
else
  sudo apt-get install neovim
fi

# Install Vim-Plug
echo "Installing Vim-Plug"
curl -fLo ~/.local/share/nvim/site/autoload/plug.vim --create-dirs https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim

# Install and configure fzf
echo "Installing fzf"
if [ "$(uname)" == "Darwin" ]; then
  brew install fzf
else
  sudo apt-get install fzf
fi

# Install and configure jq
echo "Installing jq"
if [ "$(uname)" == "Darwin" ]; then
  brew install jq
else
  sudo apt-get install jq
fi

# Install nvm
echo "Installing nvm"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash

# Install Node.js
echo "Installing Node.js 10"
nvm use 10

# Configure npm
echo "Configuring npm"
npm config set init.author.name "Tomas Della Vedova"
npm config set init.author.email "tommydelved@gmail.com"
npm config set init.author.github "delvedor"

# TODO
# git credentials
# install vim plugins (via plug)
