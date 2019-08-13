# Path to your oh-my-zsh installation.
case "$OSTYPE" in
  darwin*)
    export ZSH=/Users/delvedor/.oh-my-zsh
  ;;
  linux*)
    export ZSH=/home/delvedor/.oh-my-zsh
  ;;
esac

# Theme conf
ZSH_THEME="avit"

# Case-sensitive completion.
CASE_SENSITIVE="true"

# Command auto-correction.
ENABLE_CORRECTION="true"

# colors for tmux
if [[ $TERM == xterm ]]; then TERM=xterm-256color; fi

# Custom folder
ZSH_CUSTOM=~/.zsh_custom

# Plugins
plugins=(git web-search)

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/X11/bin:/Library/TeX/texbin"
export PATH="/usr/local/opt/curl/bin:$PATH"
# export MANPATH="/usr/local/man:$MANPATH"

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

export FZF_DEFAULT_COMMAND='ag -g ""'

# Default editor
export EDITOR=/usr/local/bin/nvim

# Android SDK
case "$OSTYPE" in
  darwin*)
    export ANDROID_HOME=/Users/delvedor/Library/Android/sdk
  ;;
esac

source $ZSH/oh-my-zsh.sh
# Alias Vim
alias vim="nvim"
alias vi="nvim"

# force tmux utf-8
alias tmux="tmux -u"

alias c="bat"

# Alias standard linter
alias 'lint=snazzy'

alias python='python3'

# Alias Git
alias gp='git push'
alias gpf='git push --force-with-lease'
alias gl='git pull'
alias gs='git status'
alias gc='git commit -m'
alias ga='git add'
alias gd='git diff'
alias gg="git log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
alias go='git checkout'
alias pr='!f() { git fetch -fu ${2:-upstream} refs/pull/$1/head:pr/$1 && git checkout pr/$1; }; f'

case "$OSTYPE" in
  darwin*)
    export NVM_DIR="/Users/delvedor/.nvm"
  ;;
  linux*)
    export NVM_DIR="/home/delvedor/.nvm"
  ;;
esac
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm

###-begin-npm-completion-###
#
# npm command completion script
#
# Installation: npm completion >> ~/.bashrc  (or ~/.zshrc)
# Or, maybe: npm completion > /usr/local/etc/bash_completion.d/npm
#

if type complete &>/dev/null; then
  _npm_completion () {
    local words cword
    if type _get_comp_words_by_ref &>/dev/null; then
      _get_comp_words_by_ref -n = -n @ -w words -i cword
    else
      cword="$COMP_CWORD"
      words=("${COMP_WORDS[@]}")
    fi

    local si="$IFS"
    IFS=$'\n' COMPREPLY=($(COMP_CWORD="$cword" \
                           COMP_LINE="$COMP_LINE" \
                           COMP_POINT="$COMP_POINT" \
                           npm completion -- "${words[@]}" \
                           2>/dev/null)) || return $?
    IFS="$si"
  }
  complete -o default -F _npm_completion npm
elif type compdef &>/dev/null; then
  _npm_completion() {
    local si=$IFS
    compadd -- $(COMP_CWORD=$((CURRENT-1)) \
                 COMP_LINE=$BUFFER \
                 COMP_POINT=0 \
                 npm completion -- "${words[@]}" \
                 2>/dev/null)
    IFS=$si
  }
  compdef _npm_completion npm
elif type compctl &>/dev/null; then
  _npm_completion () {
    local cword line point words si
    read -Ac words
    read -cn cword
    let cword-=1
    read -l line
    read -ln point
    si="$IFS"
    IFS=$'\n' reply=($(COMP_CWORD="$cword" \
                       COMP_LINE="$line" \
                       COMP_POINT="$point" \
                       npm completion -- "${words[@]}" \
                       2>/dev/null)) || return $?
    IFS="$si"
  }
  compctl -K _npm_completion npm
fi
###-end-npm-completion-###

# tabtab source for electron-forge package
# uninstall by removing these lines or running `tabtab uninstall electron-forge`
[[ -f /Users/delvedor/.nvm/versions/node/v6.9.4/lib/node_modules/electron-forge/node_modules/tabtab/.completions/electron-forge.zsh ]] && . /Users/delvedor/.nvm/versions/node/v6.9.4/lib/node_modules/electron-forge/node_modules/tabtab/.completions/electron-forge.zsh
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
