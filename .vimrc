" General

" Plugin list:
" - YouCompleteMe
" - syntastic
" - vim-airline
" - vim-airline-themes
" - nerdtree
" - tern_for_vim
" - vim-colors-solarized
" - vim-markdown
" - vim-javascript
" - vim-devicons

" Pathogen plugin
execute pathogen#infect()

" Syntax on by default
syntax on

" Color scheme
" - Onedark
" colorscheme onedark
" let g:airline_theme='onedark'
" - Solarized
" > Solarized light:
" set background=light
" > Solarized dark:
set background=dark
colorscheme solarized
let g:airline_theme='solarized'
let g:airline_powerline_fonts = 1

set laststatus=2
"set showtabline=2

" Font
set encoding=utf8
set guifont=Droid\ Sans\ Mono\ for\ Powerline\ Plus\ Nerd\ File\ Types:h14
" set gfn=Meslo\ LG\ M\ for\ Powerline

" Syntastic
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0
let g:airline#extensions#syntastic#enabled = 1
" Standard syntax style for Javascript (automatic fortmatting on save)
let g:syntastic_javascript_checkers = ['standard']
" autocmd bufwritepost *.js silent !standard % --format
" set autoread

" YouCompleteMe
let g:ycm_add_preview_to_completeopt = 1
let g:ycm_autoclose_preview_window_after_completion = 1

" NERDTree
" -> on startup
" autocmd vimenter * NERDTree
let NERDTreeShowHidden=1
let NERDTreeIgnore = ['\.swp$']

" Markdown for Vim
let g:markdown_enable_spell_checking = 0

" Show line numbers
set number
set relativenumber

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

" Disable arrow keys both in Normal and Insert mode
map <up> <nop>
map <down> <nop>
map <left> <nop>
map <right> <nop>
imap <up> <nop>
imap <down> <nop>
imap <left> <nop>
imap <right> <nop>
" Get off my lawn
nnoremap <Left> :echoe " Use h "<CR>
nnoremap <Right> :echoe " Use l "<CR>
nnoremap <Up> :echoe " Use k "<CR>
nnoremap <Down> :echoe " Use j "<CR>

" Remap split navigation for quicker window movement
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-h> <C-w>h
nnoremap <C-l> <C-w>l

" Automatically fitting the quickfix window height
au FileType qf call AdjustWindowHeight(1, 10)
function! AdjustWindowHeight(minheight, maxheight)
  exe max([min([line("$"), a:maxheight]), a:minheight]) . "wincmd _"
endfunction
