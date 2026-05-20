if status is-interactive
# Commands to run in interactive sessions can go here
  # Alias Vim
  alias vim="nvim"
  alias vi="nvim"

  # Alias Git
  alias gp='git push'
  alias gpf='git push --force-with-lease'
  alias gl='git pull'
  alias gs='git status'
  alias gc='git commit -m'
  alias ga='git add'
  alias gd='git diff'
  alias gg="git log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
  alias gco='git checkout'

  # force tmux utf-8
  alias tmux="tmux -u"

  alias c="bat"

  alias python='python3'
  alias pip='pip3'

  alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
end

set -g fish_key_bindings fish_vi_key_bindings

# Pi
fish_add_path "/Users/delvedor/.local/share/fnm/node-versions/v24.14.0/installation/bin"
