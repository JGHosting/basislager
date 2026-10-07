import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { fitViewport } from './core/viewport';

fitViewport();

mount(App, { target: document.getElementById('app')! });
