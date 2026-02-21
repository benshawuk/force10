<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::inertia('/', 'Home');
Route::inertia('/about', 'About');
Route::resource('users', UserController::class)->only(['index', 'show']);
