// === НАВИГАЦИЯ МЕЖДУ СТРАНИЦАМИ ===
document.getElementById('start-button').addEventListener('click', function() {
  document.getElementById('welcome-page').style.display = 'none';
  document.getElementById('map-page').style.display = 'block';
  document.getElementById('sources-page').style.display = 'none';
  
  // Инициализируем карту только при первом открытии
  if (!window.mapInitialized) {
    setTimeout(function() {
      initMap();
      window.mapInitialized = true;
    }, 100);
  }
});

document.getElementById('back-button').addEventListener('click', function() {
  document.getElementById('map-page').style.display = 'none';
  document.getElementById('welcome-page').style.display = 'flex';
  document.getElementById('sources-page').style.display = 'none';
});

// Кнопка "Источники" на странице приветствия
document.getElementById('sources-from-welcome').addEventListener('click', function() {
  document.getElementById('welcome-page').style.display = 'none';
  document.getElementById('map-page').style.display = 'none';
  document.getElementById('sources-page').style.display = 'block';
});

// Кнопка "Источники" на странице с картой
document.getElementById('sources-button').addEventListener('click', function() {
  document.getElementById('map-page').style.display = 'none';
  document.getElementById('welcome-page').style.display = 'none';
  document.getElementById('sources-page').style.display = 'block';
});

// Кнопка "Назад" со страницы источников
document.getElementById('back-from-sources').addEventListener('click', function() {
  document.getElementById('sources-page').style.display = 'none';
  document.getElementById('welcome-page').style.display = 'flex';
  document.getElementById('map-page').style.display = 'none';
});

// === ИНИЦИАЛИЗАЦИЯ КАРТЫ ===
function initMap() {
  // карта
  const map = L.map('map', {
    attributionControl: false
  }).setView([20, 0], 2);

  // базовая карта
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
    noWrap: true,
    minZoom: 2,
    maxZoom: 5
  }).addTo(map);
  
  setTimeout(function() {
    map.invalidateSize();
  }, 100);

  // Данные об уровне опасности
  const safetyData = {
    "Ukraine": {
    level: "Чрезвычайно опасно",
    color: "#c0392b",  // Ярко-красный
    description: "Ведутся активные боевые действия в рамках специальной военной операции. Согласно совместному докладу МИД России и МИД Беларуси (2025), в стране наблюдается системное нарушение прав человека. Действующий режим характеризуется авторитарными методами правления, тотальной цензурой и подавлением оппозиции. Отмечается дискриминационная политика по отношению к русскоязычному населению: запрещено использование русского языка в образовании, СМИ и общественной жизни. Проводится масштабная кампания по переименованию топографических объектов и уничтожению памятников российским деятелям культуры и истории.",
    additionalInfo: "Религиозная ситуация: С августа 2024 года действует закон, создающий механизм для запрета Украинской православной церкви, что привело к новому витку гонений на священнослужителей и захвату храмов. Мобилизация: Введены жесткие ограничения на передвижение мужчин призывного возраста (18-60 лет). Зафиксированы многочисленные случаи насильственной мобилизации, задержаний и принудительных приводов в военкоматы. Права человека: Международный Суд ООН (январь 2024) отказался признать республики Донбасса 'террористическими организациями'. Комитет ООН по правам человека (2021) указал на системные проблемы с пытками со стороны силовых структур и дискриминацию внутренне перемещенных лиц.",
    recommendations: "МИД России категорически не рекомендует посещение Украины гражданам РФ. Высокий риск задержания, преследования по политическим мотивам. Зафиксированы случаи незаконного содержания под стражей, пыток и жестокого обращения. Отсутствуют механизмы правовой защиты для российских граждан. Ведутся активные боевые действия на территории страны.",
    visa: "Въезд для граждан РФ закрыт с 2022 года"
  },
    "Turkey": {
      level: "Низкий риск",
      color: "#3498db",
      description: "Популярное туристическое направление",
      recommendations: "Следить за личными вещами в туристических местах",
      visa: "Не требуется (до 60 дней)"
    },
    "Egypt": {
      level: "Средний риск",
      color: "#f39c12",
      description: "Требуется осторожность",
      recommendations: "Избегать отдалённых районов",
      visa: "Виза по прибытию ($25)"
    },
    "Syria": {
      level: "Высокий риск",
      color: "#e74c3c",
      description: "Не рекомендуется для посещения",
      recommendations: "Воздержаться от поездок",
      visa: "Требуется виза (сложно получить)"
    }
  };

  // стиль стран
function style(feature) {
  const countryName = feature.properties.name;
  const data = safetyData[countryName];
  
  // Россия - серая и без заливки
  if (countryName === "Россия") {
    return {
      fillColor: "transparent",  // Прозрачная
      weight: 1,
      color: "#999",  // Серая граница
      fillOpacity: 0
    };
  }
  
  return {
    fillColor: data ? data.color : "#cccccc",
    weight: 1,
    color: "#666",
    fillOpacity: 0.6
  };
}

  // обработка каждой страны
function onEachFeature(feature, layer) {
  const countryName = feature.properties.name;
  const countryCode = feature.properties["ISO3166-1-Alpha-3"] || "";
  const data = safetyData[countryName];
  
  // Россия некликабельна
  if (countryName === "Россия") {
    return; // Просто выходим, не добавляем обработчики
  }
  
  layer.on({
    click: function() {
      console.log("Клик по стране:", countryName);
      openSidePanel(countryName, countryCode, data);
    },
    mouseover: function(e) {
      e.target.setStyle({ fillOpacity: 0.9 });
    },
    mouseout: function(e) {
      e.target.setStyle({ fillOpacity: 0.6 });
    }
  });
}

  // загрузка GeoJSON
  fetch("countries.geojson")
    .then(res => res.json())
    .then(data => {
      const countriesLayer = L.geoJSON(data, {
        style: style,
        onEachFeature: onEachFeature
      }).addTo(map);

      countriesLayer.bringToFront();
    })
    .catch(error => {
      console.error("Ошибка загрузки GeoJSON:", error);
    });

  // Сохраняем карту в глобальную переменную для доступа при изменении размера
  window.mapInstance = map;
}

// === ФУНКЦИИ ДЛЯ БОКОВОЙ ПАНЕЛИ ===
function openSidePanel(countryName, countryCode, data) {
  const panel = document.getElementById('side-panel');
  const content = document.getElementById('panel-content');
  const map = document.getElementById('map');
  
  // Формируем содержимое панели
  let panelHTML = `
    <div class="country-header">
      <h2>${countryName}</h2>
      <span class="country-code">${countryCode}</span>
    </div>
  `;
  
  if (data) {
    panelHTML += `
      <div class="safety-level">
        <h3>Уровень опасности</h3>
        <span class="level-badge" style="background-color: ${data.color}">
          ${data.level}
        </span>
      </div>
      
      <div class="info-section visa-info">
        <h3>Визовый режим</h3>
        <p>${data.visa}</p>
      </div>
      
      <div class="info-section">
        <h3>Описание ситуации</h3>
        <p>${data.description}</p>
      </div>
    `;
    
    // Добавляем дополнительную информацию, если она есть
    if (data.additionalInfo) {
      panelHTML += `
        <div class="info-section additional-info">
          <h3>Дополнительная информация</h3>
          <p>${data.additionalInfo}</p>
        </div>
      `;
    }
    
    panelHTML += `
      <div class="info-section recommendations">
        <h3>Рекомендации</h3>
        <p>${data.recommendations}</p>
      </div>
    `;
  } else {
    panelHTML += `
      <div class="info-section">
        <p style="color: #999; font-style: italic;">
          Информация о данной стране пока не добавлена в базу данных.
        </p>
      </div>
    `;
  }
  
  content.innerHTML = panelHTML;
  panel.classList.add('open');
  map.classList.add('panel-open');
}

function closeSidePanel() {
  const panel = document.getElementById('side-panel');
  const map = document.getElementById('map');
  
  panel.classList.remove('open');
  map.classList.remove('panel-open');
}

// Обработчик закрытия панели
document.addEventListener('DOMContentLoaded', function() {
  const closeBtn = document.getElementById('close-panel');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSidePanel);
  }
});

// Перерисовка карты при изменении размера окна
window.addEventListener('resize', function() {
  if (window.mapInitialized && window.mapInstance) {
    setTimeout(function() {
      window.mapInstance.invalidateSize();
    }, 100);
  }
});