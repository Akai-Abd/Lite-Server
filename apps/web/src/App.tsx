import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'

// Helper: Format bytes to human readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Helper: Get icon based on file type or extension
function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '🖼️'
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵'
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬'
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '📦'
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return '📄'
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs', 'css', 'html'].includes(ext)) return '💻'
  return '📃'
}

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'user' | 'guest'
  status?: string
}

function App() {
  // Navigation & View Mode State
  const [activeView, setActiveView] = useState<'files' | 'admin'>('files')

  // File Explorer State
  const [files, setFiles] = useState<any[]>([])
  const [currentPath, setCurrentPath] = useState('/uploads')
  const [uploadMode, setUploadMode] = useState<'file' | 'folder'>('file')
  const [isUploadingFolder, setIsUploadingFolder] = useState(false)
  const [folderUploadStatus, setFolderUploadStatus] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Auth & User State
  const [token, setToken] = useState(() => localStorage.getItem('ar-web-token') || '')
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('ar-web-user')
    return savedUser ? JSON.parse(savedUser) : null
  })
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('ar-web-token'))

  // Admin Panel User Management State
  const [users, setUsers] = useState<User[]>([])
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [userFormData, setUserFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user',
  })

  // View Modes & Categories
  type Category = 'All' | 'Images' | 'Videos' | 'Archive' | 'Folders' | 'Documents'
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [activeCategory, setActiveCategory] = useState<Category>('All')
  const [pathCategories, setPathCategories] = useState<Record<string, Category>>({'/uploads': 'All'})

  // File Preview State
  const [previewFile, setPreviewFile] = useState<{ path: string, name: string, type: 'image' | 'video' | 'document' } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')

  useEffect(() => {
    if (!previewFile) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl('')
      return
    }
    fetch(`/api/files/download?path=${encodeURIComponent(previewFile.path)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(r => r.blob())
    .then(blob => setPreviewUrl(URL.createObjectURL(blob)))
  }, [previewFile, token])

  const handleCategoryChange = (cat: Category) => {
    setActiveCategory(cat)
    setPathCategories(prev => ({ ...prev, [currentPath]: cat }))
  }

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    setActiveCategory(pathCategories[path] || 'All')
  }

  const handlePreview = (file: any) => {
    if (file.type === 'directory') return;
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    let type: 'image' | 'video' | 'document' | null = null
    
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext)) type = 'image'
    else if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) type = 'video'
    else if (['pdf', 'txt', 'md', 'csv', 'json', 'log'].includes(ext)) type = 'document'
    
    if (type) {
      setPreviewFile({ path: file.virtualPath, name: file.name, type })
    } else {
      // If not previewable, just download
      handleDownload(file.virtualPath, file.name)
    }
  }

  const filteredFiles = useMemo(() => {
    return files.filter(file => {
      if (activeCategory === 'All') return true;
      if (activeCategory === 'Folders') return file.type === 'directory';
      
      if (file.type === 'directory') return false;
      
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (activeCategory === 'Images') return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext);
      if (activeCategory === 'Videos') return ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext);
      if (activeCategory === 'Archive') return ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext);
      if (activeCategory === 'Documents') return ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx'].includes(ext);
      
      return false;
    });
  }, [files, activeCategory]);

  // Load files from server for target path
  const loadFiles = async (path: string = currentPath, authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (response.ok) {
        setIsAuthenticated(true)
        const result = await response.json()
        if (result.success) {
          setFiles(result.data)
        }
      } else if (response.status === 401) {
        handleLogout()
      }
    } catch (error) {
      console.error('Load files error:', error)
    }
  }

  // Load user list for admin console
  const loadUsers = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) {
        setUsers(result.data.items || [])
      }
    } catch (error) {
      console.error('Load users error:', error)
    }
  }

  useEffect(() => {
    if (token) {
      loadFiles(currentPath, token)
      if (user?.role === 'admin') {
        loadUsers(token)
      }
    }
  }, [token, currentPath, user?.role])

  // Single / Batch File Drop Handler
  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    let successCount = 0
    let errorCount = 0

    for (const file of acceptedFiles) {
      const formData = new FormData()
      formData.append('file', file)

      const relPath = file.webkitRelativePath || file.name
      const targetQuery = currentPath === '/uploads' ? relPath : `${currentPath.replace(/^\/uploads\/?/, '')}/${relPath}`

      try {
        const b64Path = btoa(unescape(encodeURIComponent(targetQuery)))
        const response = await fetch(`/api/files/upload?pathBase64=${b64Path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })

        if (response.status === 401) {
          handleLogout()
          alert('Your session has expired. Please log in again.')
          return
        }

        const result = await response.json()
        if (result.success) successCount++
        else errorCount++
      } catch {
        errorCount++
      }
    }

    if (successCount > 0 && errorCount === 0) {
      alert(`Successfully uploaded ${successCount} file(s)`)
    } else {
      alert(`Upload complete: ${successCount} succeeded, ${errorCount} failed`)
    }

    if (successCount > 0) {
      loadFiles(currentPath)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop })

  // Folder Upload Handler
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const fileArray = Array.from(fileList)
    setIsUploadingFolder(true)
    setFolderUploadStatus(`Uploading folder (${fileArray.length} items)...`)

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('file', file)

      const relPath = file.webkitRelativePath || file.name
      const targetQuery = currentPath === '/uploads' ? relPath : `${currentPath.replace(/^\/uploads\/?/, '')}/${relPath}`

      setFolderUploadStatus(`Uploading file ${i + 1}/${fileArray.length}: ${file.name}`)

      try {
        const b64Path = btoa(unescape(encodeURIComponent(targetQuery)))
        const response = await fetch(`/api/files/upload?pathBase64=${b64Path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })

        if (response.status === 401) {
          handleLogout()
          alert('Your session has expired. Please log in again.')
          setIsUploadingFolder(false)
          return
        }

        const result = await response.json()
        if (result.success) successCount++
        else errorCount++
      } catch {
        errorCount++
      }
    }

    setIsUploadingFolder(false)
    setFolderUploadStatus('')
    alert(`Folder upload complete: ${successCount} files uploaded successfully (${errorCount} failed)`)
    loadFiles(currentPath)

    if (folderInputRef.current) {
      folderInputRef.current.value = ''
    }
  }

  // Login Handler
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const result = await response.json()
      if (result.success) {
        const newToken = result.data.token
        const loggedInUser = result.data.user
        localStorage.setItem('ar-web-token', newToken)
        localStorage.setItem('ar-web-user', JSON.stringify(loggedInUser))
        setToken(newToken)
        setUser(loggedInUser)
        setIsAuthenticated(true)
        await loadFiles('/uploads', newToken)
        if (loggedInUser.role === 'admin') {
          await loadUsers(newToken)
        }
        alert(`Welcome back, ${loggedInUser.username}!`)
      } else {
        alert('Login failed: ' + (result.error?.message || 'Unknown error'))
      }
    } catch (error) {
      console.error('Login error:', error)
      alert('Login error: ' + error)
    }
  }

  // Create User Handler (Admin Console)
  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!userFormData.username || !userFormData.email || !userFormData.password) {
      alert('Please fill in all fields')
      return
    }

    setIsCreatingUser(true)
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userFormData),
      })

      const result = await response.json()
      if (result.success) {
        setShowAddUserModal(false)
        setUserFormData({ username: '', email: '', password: '', role: 'user' })
        await loadUsers(token)
        alert('User created successfully!')
      } else {
        alert(`Error: ${result.error?.message || 'Failed to create user'}`)
      }
    } catch (error) {
      console.error('Create user error:', error)
      alert('Failed to create user')
    } finally {
      setIsCreatingUser(false)
    }
  }

  // Delete User Handler (Admin Console)
  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      const result = await response.json()
      if (result.success) {
        await loadUsers(token)
        alert('User deleted successfully!')
      }
    } catch (error) {
      console.error('Delete user error:', error)
      alert('Failed to delete user')
    }
  }

  // Change User Password Handler (Admin Console)
  const handleChangePassword = async (userId: string, username: string) => {
    const newPassword = prompt(`Enter new password for ${username}:`)
    if (!newPassword) return

    if (newPassword.length < 4) {
      alert('Password must be at least 4 characters long')
      return
    }

    try {
      const response = await fetch(`/api/users/${userId}/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: newPassword }),
      })

      const result = await response.json()
      if (result.success) {
        alert('Password updated successfully!')
      } else {
        alert(result.error?.message || 'Failed to update password')
      }
    } catch (error) {
      console.error('Update password error:', error)
      alert('Failed to update password')
    }
  }

  // File Download Handler
  const handleDownload = async (path: string, name: string) => {
    try {
      const response = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
    }
  }

  const handleDownloadZip = async (path: string, name: string) => {
    try {
      const response = await fetch(`/api/files/download-zip?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.zip`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download ZIP error:', error)
    }
  }

  // Single Item Delete Handler
  const handleDelete = async (path: string) => {
    if (!confirm(`Are you sure you want to delete ${path}?`)) return

    try {
      const response = await fetch('/api/files', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      })

      if (response.status === 401) {
        handleLogout()
        alert('Your session has expired. Please log in again.')
        return
      }

      const result = await response.json()
      if (result.success) {
        alert('Item deleted successfully')
        await loadFiles(currentPath)
      } else {
        alert(`Error deleting item: ${result.error?.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete item')
    }
  }

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedFiles.length} selected item(s)?`)) return

    try {
      const response = await fetch('/api/files/bulk', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paths: selectedFiles }),
      })

      if (response.status === 401) {
        handleLogout()
        alert('Your session has expired. Please log in again.')
        return
      }

      const result = await response.json()
      if (result.success) {
        const { succeeded, failed } = result.data
        alert(`Bulk delete complete: ${succeeded.length} succeeded, ${failed.length} failed`)
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : (result.error?.message || result.message || 'Unknown error')
        alert(`Error during bulk delete: ${errMsg}`)
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert('Failed to perform bulk delete')
    }

    setSelectedFiles([])
    await loadFiles(currentPath)
  }

  // Select All Checkbox Handler
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedFiles(files.map(f => f.virtualPath))
    } else {
      setSelectedFiles([])
    }
  }

  // Logout Handler
  const handleLogout = () => {
    localStorage.removeItem('ar-web-token')
    localStorage.removeItem('ar-web-user')
    setToken('')
    setUser(null)
    setIsAuthenticated(false)
    setFiles([])
    setSelectedFiles([])
    setActiveView('files')
  }

  // Calculate Breadcrumb parts
  const getBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(Boolean)
    const crumbs = []
    let accumulated = ''
    for (let i = 0; i < parts.length; i++) {
      accumulated += '/' + parts[i]
      crumbs.push({ name: parts[i], path: accumulated })
    }
    return crumbs
  }

  const totalStorageBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)

  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="ambient-glow-primary" />
        <div className="login-card">
          <div className="brand-section" style={{ marginBottom: '1.25rem' }}>
            <div className="brand-icon">📁</div>
            <div>
              <h1 className="brand-title">AR File Hub</h1>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cloud File Manager Console</p>
            </div>
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                name="username"
                type="text"
                placeholder="Enter username"
                required
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="form-input"
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem', justifyContent: 'center' }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="ambient-glow-primary" />
      <div className="ambient-glow-secondary" />

      {/* Top Navbar */}
      <header className="app-navbar">
        <div className="brand-section">
          <div className="brand-icon">📁</div>
          <div className="brand-title">
            AR File Hub <span className="brand-badge">v1.0</span>
          </div>
        </div>

        {/* View Switcher Tabs (Only Admin role sees Admin Console tab) */}
        <div className="nav-views-switcher">
          <button
            onClick={() => setActiveView('files')}
            className={`nav-view-btn ${activeView === 'files' ? 'active' : ''}`}
          >
            📁 File Hub
          </button>
          {user?.role === 'admin' && (
            <button
              onClick={() => setActiveView('admin')}
              className={`nav-view-btn ${activeView === 'admin' ? 'active' : ''}`}
            >
              🛡️ Admin Console
            </button>
          )}
        </div>

        <div className="navbar-right">
          <div className="status-indicator">
            <span className="status-dot" />
            <span>Connected ({user?.username})</span>
          </div>
          <button onClick={handleLogout} className="btn btn-danger">
            Logout
          </button>
        </div>
      </header>

      {/* File Hub View */}
      {activeView === 'files' && (
        <div className="dashboard-grid">
          {/* Left Sidebar */}
          <aside className="sidebar-panel">
            <div className="sidebar-card">
              <div className="sidebar-card-title">Storage Summary</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff' }}>
                {formatBytes(totalStorageBytes)}
              </div>
              <div className="storage-progress-bg">
                <div className="storage-progress-fill" style={{ width: '15%' }} />
              </div>
              <div className="storage-stats-text">
                <span>{files.length} items in folder</span>
                <span>Local Mount</span>
              </div>
            </div>

            <div className="sidebar-card">
              <div className="sidebar-card-title">Quick Views</div>
              <button className="sidebar-nav-item active" onClick={() => handleNavigate('/uploads')}>
                <span>📂</span> All Uploads
              </button>
            </div>
          </aside>

          {/* Main Explorer Column */}
          <main className="main-explorer">
            {/* Upload Card */}
            <div className="upload-card">
              <div className="upload-tabs">
                <button
                  onClick={() => setUploadMode('file')}
                  className={`tab-btn ${uploadMode === 'file' ? 'active' : ''}`}
                >
                  📄 Single / Batch Files
                </button>
                <button
                  onClick={() => setUploadMode('folder')}
                  className={`tab-btn ${uploadMode === 'folder' ? 'active' : ''}`}
                >
                  📁 Whole Folder
                </button>
              </div>

              {/* Hidden Folder Picker Input */}
              <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                onChange={handleFolderUpload}
              />

              {uploadMode === 'file' ? (
                <div
                  {...getRootProps()}
                  className={`dropzone-box ${isDragActive ? 'active' : ''}`}
                >
                  <input {...getInputProps()} />
                  <div className="drop-icon">☁️</div>
                  {isDragActive ? (
                    <p className="drop-title">Release to upload files</p>
                  ) : (
                    <>
                      <p className="drop-title">Drag & drop files here, or click to browse</p>
                      <p className="drop-sub">Upload single or multiple files directly to current folder</p>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="dropzone-box folder"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <div className="drop-icon">📁</div>
                  <p className="drop-title">Click to Select Folder & Subdirectories</p>
                  <p className="drop-sub">Uploads full directory hierarchy recursively</p>
                  {isUploadingFolder && (
                    <div className="upload-progress-box">
                      <span>⏳</span>
                      <span>{folderUploadStatus}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Breadcrumbs Card */}
            <div className="breadcrumbs-card">
              <button 
                className="back-button"
                onClick={() => handleNavigate(currentPath.split('/').slice(0, -1).join('/') || '/uploads')}
                disabled={currentPath === '/uploads'}
                style={{ opacity: currentPath === '/uploads' ? 0.5 : 1 }}
              >
                ← Back
              </button>
              <span className="crumb-item" onClick={() => handleNavigate('/uploads')}>
                Root (/uploads)
              </span>
              {getBreadcrumbs().slice(1).map((crumb) => (
                <React.Fragment key={crumb.path}>
                  <span className="crumb-sep">/</span>
                  <span className="crumb-item" onClick={() => handleNavigate(crumb.path)}>
                    {crumb.name}
                  </span>
                </React.Fragment>
              ))}
            </div>

            {/* File Explorer Table */}
            <div className="explorer-card">
              <div className="toolbar">
                <div className="category-tabs">
                  {(['All', 'Images', 'Videos', 'Archive', 'Folders', 'Documents'] as Category[]).map(cat => (
                    <button
                      key={cat}
                      className={`category-tab ${activeCategory === cat ? 'active' : ''}`}
                      onClick={() => handleCategoryChange(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="view-toggles">
                  <button 
                    className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setViewMode('list')}
                    title="List View"
                  >
                    ☰
                  </button>
                  <button 
                    className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    title="Grid View"
                  >
                    ⊞
                  </button>
                </div>
              </div>

              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>Directory Items</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-color)' }}>
                    {filteredFiles.length}
                  </span>
                </div>
              </div>

              {selectedFiles.length > 0 && (
                <div className="bulk-actions-bar">
                  <span>{selectedFiles.length} item(s) selected</span>
                  {user?.role === 'admin' ? (
                    <button onClick={handleBulkDelete} className="btn btn-danger">
                      Delete Selected
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Admin permissions required to delete</span>
                  )}
                </div>
              )}

              {filteredFiles.length > 0 && viewMode === 'list' && (
                <div className="table-controls-row">
                  <input
                    type="checkbox"
                    id="select-all"
                    checked={selectedFiles.length === filteredFiles.length && filteredFiles.length > 0}
                    onChange={handleSelectAll}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="select-all" style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Select All
                  </label>
                </div>
              )}

              {filteredFiles.length === 0 ? (
                <div className="empty-state">
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</p>
                  <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No items found in this category</p>
                  <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>Change category or upload new files.</p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="file-grid">
                  {filteredFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file.virtualPath)
                    const isDirectory = file.type === 'directory'
                    const icon = getFileIcon(file.name, isDirectory)
                    return (
                      <div key={file.id} className={`file-grid-item ${isSelected ? 'selected' : ''}`} onClick={() => isDirectory ? null : handlePreview(file)} onDoubleClick={() => isDirectory ? handleNavigate(file.virtualPath) : null}>
                        <div className="checkbox-wrapper">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedFiles(prev => [...prev, file.virtualPath])
                              else setSelectedFiles(prev => prev.filter(id => id !== file.virtualPath))
                            }}
                            style={{ width: 16, height: 16, cursor: 'pointer' }}
                          />
                        </div>
                        <div className="actions-wrapper">
                          <button onClick={() => isDirectory ? handleDownloadZip(file.virtualPath, file.name) : handleDownload(file.virtualPath, file.name)} className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}>
                            DL
                          </button>
                        </div>
                        <div className="file-icon-large" onClick={() => isDirectory ? handleNavigate(file.virtualPath) : null}>{icon}</div>
                        <div className="file-name-text" title={file.name}>{file.name}</div>
                        <div className="file-size-text">{isDirectory ? 'Folder' : formatBytes(file.size || 0)}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div>
                  {filteredFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file.virtualPath)
                    const isDirectory = file.type === 'directory'
                    const icon = getFileIcon(file.name, isDirectory)
                    return (
                      <div key={file.id} className={`file-row ${isSelected ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFiles((prev) => [...prev, file.virtualPath])
                            } else {
                              setSelectedFiles((prev) => prev.filter((id) => id !== file.virtualPath))
                            }
                          }}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <div className="file-name-cell">
                          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                          {isDirectory ? (
                            <span
                              className="file-name-text folder-click"
                              onClick={() => handleNavigate(file.virtualPath)}
                            >
                              {file.name}/
                            </span>
                          ) : (
                            <span className="file-name-text" style={{ cursor: 'pointer' }} onClick={() => handlePreview(file)}>{file.name}</span>
                          )}
                        </div>
                        <div className="file-size-cell">
                          {isDirectory ? 'Folder' : formatBytes(file.size || 0)}
                        </div>
                        <div className="file-actions-cell">
                          <button onClick={() => isDirectory ? handleDownloadZip(file.virtualPath, file.name) : handleDownload(file.virtualPath, file.name)} className="btn btn-secondary">
                            {isDirectory ? 'Zip & DL' : 'Download'}
                          </button>
                          {user?.role === 'admin' && (
                            <button onClick={() => handleDelete(file.virtualPath)} className="btn btn-danger">
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="modal-backdrop" onClick={() => setPreviewFile(null)} style={{ zIndex: 1000, justifyContent: 'flex-end', padding: 0, background: 'rgba(0,0,0,0.2)', backdropFilter: 'none' }}>
          <div className="modal-card" style={{ maxWidth: '90vw', width: '500px', height: '100vh', maxHeight: '100vh', borderRadius: 0, padding: '1.5rem', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={previewFile.name}>{previewFile.name}</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => handleDownload(previewFile.path, previewFile.name)} className="btn btn-primary" style={{ padding: '0.25rem 0.5rem' }}>Download</button>
                <button onClick={() => setPreviewFile(null)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>✕</button>
              </div>
            </div>
            <div style={{ width: '100%', flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden', background: '#000', borderRadius: '0.5rem' }}>
              {!previewUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>Loading...</div>
              ) : previewFile.type === 'image' ? (
                <img src={previewUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt={previewFile.name} />
              ) : previewFile.type === 'video' ? (
                <video src={previewUrl} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <iframe src={previewUrl} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} title={previewFile.name} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Console View */}
      {activeView === 'admin' && user?.role === 'admin' && (
        <div className="admin-grid">
          {/* Stats Section */}
          <div className="stats-grid">
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Users</div>
                <div className="stat-val">{users.length}</div>
              </div>
              <div className="stat-icon">👥</div>
            </div>
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Mounts</div>
                <div className="stat-val">1</div>
              </div>
              <div className="stat-icon">💾</div>
            </div>
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current Files</div>
                <div className="stat-val">{files.length}</div>
              </div>
              <div className="stat-icon">📄</div>
            </div>
          </div>

          {/* User Management Section */}
          <div className="explorer-card">
            <div className="card-header-bar">
              <div className="card-header-title">
                <span>User Management</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-color)' }}>
                  {users.length} Users
                </span>
              </div>
              <button onClick={() => setShowAddUserModal(true)} className="btn btn-primary">
                + Add User
              </button>
            </div>

            <div>
              {users.length === 0 ? (
                <div className="empty-state">No users registered</div>
              ) : (
                <div>
                  {users.map((u) => (
                    <div key={u.id} className="admin-user-row">
                      <div className="admin-user-info">
                        <div className="admin-user-username">👤 {u.username}</div>
                        <div className="admin-user-email">{u.email}</div>
                      </div>
                      <div className="admin-user-badges">
                        <span className={`badge-role ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                          {u.role.toUpperCase()}
                        </span>
                        <span className="badge-role badge-active">ACTIVE</span>
                      </div>
                      <div className="file-actions-cell" style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => handleChangePassword(u.id, u.username)} className="btn btn-secondary">
                          Password
                        </button>
                        <button onClick={() => handleDeleteUser(u.id)} className="btn btn-danger">
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', marginBottom: '1rem' }}>Create New User</h2>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  value={userFormData.username}
                  onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                  placeholder="john_doe"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  placeholder="john@example.com"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  value={userFormData.password}
                  onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                  placeholder="••••••••"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  value={userFormData.role}
                  onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value as any })}
                  className="form-input"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="guest">Guest</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifySelf: 'flex-end', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setShowAddUserModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isCreatingUser} className="btn btn-primary">
                  {isCreatingUser ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App