" Plugins
call plug#begin('~/.local/share/nvim/plugged')

Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'w0rp/ale'
Plug 'ryanoasis/vim-devicons'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
" Plug 'rakr/vim-one'
Plug 'tomasiser/vim-code-dark'
Plug 'pangloss/vim-javascript'
Plug 'HerringtonDarkholme/yats.vim'
Plug 'tpope/vim-sensible'
Plug 'tpope/vim-commentary', {'on': '<Plug>Commentary'}
Plug 'scrooloose/nerdtree', { 'on': 'NERDTreeToggle' }
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'plasticboy/vim-markdown', { 'for': 'markdown' }
Plug 'editorconfig/editorconfig-vim'
Plug 'pechorin/any-jump.vim', { 'on': 'AnyJump' }
Plug 'evanleck/vim-svelte', { 'branch': 'main' }

call plug#end()

" Display Settings
syntax on
if has('termguicolors')
  set termguicolors
endif
syntax enable
set t_Co=256
" Disable Background Color Erase (tmux)
if &term =~ '256color'
  set t_ut=
endif

" git diffing algorithms
if has('nvim-0.3.2') || has("patch-8.1.0360")
  set diffopt=filler,internal,algorithm:histogram,indent-heuristic
endif

" Color scheme
" let g:airline_theme='one'
" colorscheme one
let g:airline_theme = 'codedark'
colorscheme codedark
" set to 'light' to use the light version
" of the color scheme
set background=dark
let g:airline_powerline_fonts = 1

" NERDTree
let NERDTreeShowHidden=1
let NERDTreeIgnore = ['\.swp$', '\.DS_Store$']
nmap <silent> <C-\> :NERDTreeToggle<CR>

" Ale
let g:ale_lint_on_text_changed = 'never'
let g:ale_completion_enabled = 1
let g:ale_set_highlights = 1
let g:ale_sign_error = '●'
let g:ale_sign_warning = '●'
let g:ale_fixers = {
\   'javascript': []
\}
let g:ale_linters = {
\   'javascript': ['standard'],
\   'typescript': ['ts-standard']
\}
highlight ALEStyleWarning ctermfg=Black
highlight ALEStyleWarning ctermbg=Yellow
highlight ALEWarning ctermfg=Black
highlight ALEWarning ctermbg=Yellow
highlight ALEStyleError ctermfg=Black
highlight ALEStyleError ctermbg=Red
highlight ALEError ctermfg=Black
highlight ALEError ctermbg=Red
" Show error in the statusline
let g:airline#extensions#ale#enabled = 1

" Commentary
map  gc  <Plug>Commentary
nmap gcc <Plug>CommentaryLine

" deoplete
" let g:python3_host_prog = '/usr/local/bin/python3'
" let g:deoplete#enable_at_startup = 1

" any-jump
let g:any_jump_disable_default_keybindings = 1
" Normal mode: Jump to definition under cursor
nnoremap <C-o> :AnyJump<Cr>

" ctrlp
nmap <silent> <C-p> :CtrlP<CR>
" default ignore
let g:ctrlp_custom_ignore = '\v[\/](node_modules|target|dist|build)|(\.(swp|ico|git|svn))$'
" ignore what is inside the .gitignore
let g:ctrlp_user_command = ['.git/', 'git --git-dir=%s/.git ls-files -oc --exclude-standard']

" Disable default folding in markdown files
let g:vim_markdown_folding_disabled = 1

let g:goyo_width = 120

" Font
set encoding=utf8
set guifont=Droid\ Sans\ Mono\ for\ Powerline\ Plus\ Nerd\ File\ Types:h14

" Show line numbers
set number
set numberwidth=2

" Break lines at word
set linebreak

" Wrap-broken line prefix
set showbreak=+++

" Line Wrap (number of cols)
set textwidth=0

" Highlight matching brace
set showmatch

" Use visual bell (no beeping)
set visualbell

" Highlight all search results
set hlsearch

" Enable smart-case search
set smartcase

" Always case-insensitive
set ignorecase

" Searches for strings incrementally
set incsearch

" Auto-indent new lines
set autoindent

" width for autoindents
set shiftwidth=2

" number of columns occupied by a tab character
set tabstop=2

" Use spaces instead of tabs
set expandtab

" Number of auto-indent spaces
set shiftwidth=2

" Enable smart-indent
set smartindent

" Enable smart-tabs
set smarttab

" Number of spaces per Tab
set softtabstop=2

" Show row and column ruler information
set ruler

" Highlight current line
set cursorline

" Number of undo levels
set undolevels=1000

" Backspace behaviour
set backspace=indent,eol,start

" Automatically :write before running commands
set autowrite

" Open new split panes to right and bottom, which feels more natural
set splitbelow
set splitright

" Helps with slow loading
set nocompatible
set ttyfast
set lazyredraw

" Activate the cursor line only during Insert mode
set cursorline!
autocmd InsertEnter,InsertLeave * set cul!

" Reload files changed outside vim
set autoread
" Reload file with external changes on focus
au FocusGained * :checktime

" Disable arrow keys both in Normal and Insert mode
map <up> <nop>
map <down> <nop>
map <left> <nop>
map <right> <nop>
imap <left> <nop>
imap <right> <nop>
" Get off my lawn
nnoremap <Left> :echoe " Use h "<CR>
nnoremap <Right> :echoe " Use l "<CR>
nnoremap <Up> :echoe " Use k "<CR>
nnoremap <Down> :echoe " Use j "<CR>

" Focus mode
:command Focus Goyo | Limelight
:command FocusClose Goyo! | Limelight!

" Remap split navigation for quicker window movement
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-h> <C-w>h
nnoremap <C-l> <C-w>l

" Fuzzy finder
nnoremap <C-f> :Ag<Cr>
nnoremap <C-p> :Files<Cr>

" Because my left hand is lazy and keeps shift pressed
:command WQ wq
:command Wq wq
:command W w
:command Q q

" Avoids to type ':noh' after a search
:nnoremap <esc> :noh<return><esc>

" Turn Off Swap Files
set noswapfile
" Disable backup files
set nobackup
set nowritebackup

" Automatically fitting the quickfix window height
au FileType qf call AdjustWindowHeight(1, 10)
function! AdjustWindowHeight(minheight, maxheight)
  exe max([min([line("$"), a:maxheight]), a:minheight]) . "wincmd _"
endfunction
" Automatically reload vimrc when it's saved
autocmd! BufWritePost vimrc so ~/.config/nvim/init.vim"
