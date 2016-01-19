" Genearl

" Pathogen plugin
execute pathogen#infect()

" Syntax on by default
syntax on
" Color scheme
colorscheme onedark
let g:airline_theme='onedark'
set laststatus=2

" Font
set gfn=Monaco:h15

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
autocmd bufwritepost *.js silent !standard % --format
set autoread

" Show line numbers
set number

" Break lines at word
set linebreak

" Wrap-broken line prefix
set showbreak=+++

" Line Wrap (number of cols)
set textwidth=100

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
 
" Advanced
" Show row and column ruler information
set ruler
 
" Number of undo levels
set undolevels=1000

" Backspace behaviour
set backspace=indent,eol,start
