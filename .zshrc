# Path to your oh-my-zsh installation.
export ZSH=/Users/delvedor/.oh-my-zsh

# Theme conf
ZSH_THEME="avit"

# Case-sensitive completion.
CASE_SENSITIVE="true"

# Command auto-correction.
ENABLE_CORRECTION="true"


# Custom folder
ZSH_CUSTOM=~/.zsh_custom

# Plugins
plugins=(git, web-search, vi-mode)

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/X11/bin:/Library/TeX/texbin"
# export MANPATH="/usr/local/man:$MANPATH"

source $ZSH/oh-my-zsh.sh
# Alias Vim
alias 'vim=/usr/local/bin/vim'

export NVM_DIR="/Users/delvedor/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
