import { HONEST_COLOR, MALICE_COLOR, REJECTED_COLOR, UNKNOWN_COLOR, baseFPS, screen, list, 
loadImage, interpolateColor, setHeatmapBackgroundColor, isConnectionAllowed, text, order, buildPrepareMessage } from './utils.js';
import { layoutFullTopology, layoutStarTopology, layoutTreeTopology, layoutRingTopology } from './topologyLayouts.js';

(function(){
    var zoomLevel = 1;
    var offsetX = 0, offsetY = 0;
    var isDragging = false;
    var lastX, lastY;

    var remainingToLoad = 0;
	
    var honest = loadImage("pbft/honest.png");
    var malice = loadImage("pbft/malice.png");

    var timer = null;
    var probabilityMatrix = [];
	
    function exec(){
        if(timer != null){
            window.clearTimeout(timer);
            timer = null;
        }

        var g = screen.get(0).getContext("2d");
        var n =  parseInt($("#bft_n").val());
        var m = parseInt($("#bft_m").val());
        var f = Math.floor((n - 1) / 3.0);
        var maliciousOrigin = $("#bft_faulty_proposer").prop("checked");
        var falsehoodMessage = $("#bft_allow_tampering").prop("checked");
        var topology = $("#topology").val();
        var nValue = parseInt($("#n_value").val());
        var w = Math.min(screen.width(), screen.height());
        var iw = 30;
        var th = 12;
        var phase = 3;
        var phaseInterval = 2.2;
        var phaseStep = phaseInterval * baseFPS;

        // 从滑块获取速度倍数（值在1到60之间）
        var speedMultiplier = parseFloat($("#animation_speed").val());
        var interval = Math.floor(1000 / (baseFPS * (speedMultiplier / 15))); // 根据速度调整间隔

        // 判断节点是否诚实
        function isHonest(i){
            if(m == 0)  return true;
            if(maliciousOrigin){
                return i != 0 && i <= n - m;
            }
            return i == 0 || i < n - m;
        }

        // 绘制消息
        function drawMessage(msg, x, y){
            _drawMessage(x, y, [{
                text: (msg.src+1) + (msg.dst != null? ("→" + (msg.dst+1)): "") + ":" + (msg.tampered? "😈": "😇"),
                color: "#000000"
            }, {
                text: text(msg.value),
                color: msg.value == null? MALICE_COLOR: msg.value < 0? REJECTED_COLOR: (msg.value == 0? HONEST_COLOR: MALICE_COLOR)
            }]);
        }

        // 私有函数绘制消息
        function _drawMessage(x, y, msgs){
            var th = 8;
            g.font = "normal 400 " + th + "px sans-serif";
            var tws = msgs.map(function(m){ return g.measureText(m.text).width; });
            var maxWidth = Math.max.apply(null, tws);
            g.fillStyle = "#FFFFFF";
            g.fillRect(x - maxWidth / 2, y - th, maxWidth, th * msgs.length);
            g.strokeStyle = "#888888";
            g.beginPath();
            g.strokeRect(x - maxWidth / 2 - 1, y - th - 1, maxWidth + 2, th * msgs.length + 2);
            g.stroke();
            for(var i=0; i<msgs.length; i++){
                g.fillStyle = msgs[i].color;
                g.fillText(msgs[i].text, x - tws[i] / 2, y + th * i);
            }
        }

        // 绘制节点
        function drawNode(g, node, x, y, isHonest, value) {
            var img = isHonest ? honest : malice;
            g.drawImage(img, x - iw / 2, y - iw / 2, iw, iw);
            var tw = g.measureText(node + 1).width;
            g.font = "normal 700 " + th + "px sans-serif";
            g.fillStyle = "#000000";
            g.fillText(node + 1, x - tw / 2, y + iw / 2 + 12);

            function _draw(value) {
                var t = text(value);
                var thc = 8;
                g.font = "normal 400 " + thc + "px sans-serif";
                var tw = g.measureText(t).width;
                var tx = x - tw / 2;
                var ty = y + iw / 2 - 2;
                g.fillStyle = value == null ? MALICE_COLOR : value >= 0 ? HONEST_COLOR : REJECTED_COLOR;
                g.fillRect(tx - 2, ty - thc - 1, tw + 4, thc + 2);
                g.fillStyle = "#FFFFFF";
                g.fillText(t, tx, ty - 1);
            }

            _draw(value);
        }

        // 判断消息是否已送达（考虑路径连通性）
		function isMessageDelivered(probabilityMatrix, src, dst) {
			if (src === dst) return true;

			let visited = new Array(probabilityMatrix.length).fill(false);
			let queue = [src];

			while (queue.length > 0) {
				let node = queue.shift();
				if (node === dst) return true;

				visited[node] = true;

				for (let i = 0; i < probabilityMatrix[node].length; i++) {
					if (!visited[i] && probabilityMatrix[node][i] > 0 && Math.random() <= probabilityMatrix[node][i]) {
						queue.push(i);
					}
				}
			}

			return false;
		}


        // 创建预准备消息
        var prePrepare = [];
        for(var i=0; i<n; i++){
            prePrepare.push({
                src: 0, dst: i == 0? null: i, value: isHonest(0)? 0: Math.random() < 0.5? 0: 1, tampered: !isHonest(0)
            });
        }

        // 创建准备消息
		var prepare = [];
		for (var src = 0; src < n; src++) {
			var msgs = [];
			for (var dst = 0; dst < n; dst++) {
				if (src != dst && isMessageDelivered(probabilityMatrix, src, dst)) {
					var value = isHonest(src) ? prePrepare[src].value : falsehoodMessage ? Math.random() < 0.5 ? 0 : 1 : null;
					var tampered = value != prePrepare[src].value;
					msgs.push({
						src: src,
						dst: dst,
						value: value,
						tampered: tampered
					});
				}
			}
			prepare.push(msgs);
		}

		// 判断准备消息中的接受值
		function acceptedValueInPrepare(i) {
			if (!isHonest(i)) {
				return null;
			}
			var valid = prepare[i]
				.filter(function(x) { return x.dst != i && x.src != x.dst && isMessageDelivered(probabilityMatrix, x.src, x.dst); })
				.map(function(x) { return x.value; })
				.filter(function(x) { return x == prePrepare[i].value; })
				.length;
			if ((valid + 1) / (prepare[i].length + 1) >= 2 / 3) {
				return prePrepare[i].value;
			} else {
				return -1;
			}
		}

		// 创建提交消息
		var commit = [];
		for (var dst = 0; dst < n; dst++) {
			var msgs = [];
			for (var src = 0; src < n; src++) {
				if (src != dst && isMessageDelivered(probabilityMatrix, src, dst)) {
					var value = (isHonest(src) || !falsehoodMessage) ? acceptedValueInPrepare(src) : (Math.random() < 0.5 ? 0 : 1);
					var tampered = !isHonest(src);
					msgs.push({
						src: src, dst: null, value: value, tampered: tampered
					});
				}
			}
			commit.push(msgs);
		}

		// 判断提交消息中的接受值
		function acceptedValueInCommit(i) {
			if (!isHonest(i)) {
				return null;
			}
			var values = commit[i].map(function(x) { return x.value; });
			values.push(acceptedValueInPrepare(i));
			values = values.filter(function(x) { return x != null && x >= 0; });
			var zero = values.filter(function(x) { return x == 0; }).length;
			var one = values.filter(function(x) { return x == 1; }).length;
			if (zero / n >= 2 / 3) {
				return 0;
			}
			if (one / n >= 2 / 3) {
				return 1;
			}
			return -1;
		}

		// 判断所有诚实节点的提交结果是否一致
		(function() {
			var truth = 0;
			var falsehood = 0;
			var rejected = 0;
			for (var i = 0; i < n; i++) {
				if (isHonest(i)) {
					switch (acceptedValueInCommit(i)) {
						case 0: truth++; break;
						case 1: falsehood++; break;
						case -1: rejected++; break;
						default: console.log("unexpected committed state: ", acceptedValueInCommit(i)); break;
					}
				}
			}
			if (truth + falsehood + rejected == 0) {
				$("#bft_conclusion").attr("class", "badge badge-secondary").text("No non-faulty process");
			} else if (truth + falsehood == 0) {
				$("#bft_conclusion").attr("class", "badge badge-warning").html("Agreed to <i>reject the proposal</i>");
			} else if (rejected == 0 && (truth > 0 && falsehood == 0) || (truth == 0 && falsehood > 0)) {
				$("#bft_conclusion").attr("class", "badge badge-success").html("Agreed to <b>" + text(0) + "</b>");
			} else {
				$("#bft_conclusion").attr("class", "badge badge-danger").html("Contradiction, consensus failed");
			}
		})();


        // 更新表格列表
        list.empty();
        for(var i=0; i<n; i++){
            var prePrepareLabel = buildPrepareMessage(prePrepare[i]);
            if(i != 0){
                prePrepareLabel =  "<span class='bft_phase_preprepare' style='opacity:.2;'>" + prePrepareLabel + "</span>";
            }
            var prepareLabel = "<span class='bft_phase_prepare' style='line-height:100%;opacity:.2;'>" +
                prepare[i].map(function(x){ return buildPrepareMessage(x); })
                    .join("<br/>") + "<br/>" + ((function(){
                        var value = acceptedValueInPrepare(i);
                        var color = value==null? "danger": value>=0? "success": "warning";
                        var label = value==null? "<i>Arbitrary</i>": value>=0? text(value): "<i>Rejected</i>";
                        return "<span class='badge badge-" + color + " bft_phase_prepare' style='opacity:.5;'>" + label + "</span>";
                    })()) + "</span>";
            var commitLabel = "<span class='bft_phase_commit' style='opacity:.2;'>" +
                commit[i].map(function(x){ return buildPrepareMessage(x); }).join("<br/>") +
                "<br/>" + ((function(){
                    var value = acceptedValueInCommit(i);
                    var color = value==null? "danger": value>=0? "success": "warning";
                    var label = value==null? "<i>Arbitrary</i>": value>=0? text(value): "<i>Rejected</i>";
                    return "<span class='badge badge-" + color + " bft_phase_commit' style='opacity:.5;'>" + label + "</span>";
                })()) + "</span>";
            list.append($("<tr/>")
                .append($("<td/>").html((i+1) + ".<img src='" + (isHonest(i)? honest.src: malice.src) + "' height='20'/>"
                    + "<br/><b>" + (i==0? "proposer": "follower") + "</b>"))
                .append($("<td/>").html(prePrepareLabel))
                .append($("<td/>").html(prepareLabel))
                .append($("<td/>").html(commitLabel))
            );
        }

        // 根据选定的拓扑结构计算将军的位置
        var xy = [];
        var r = (w - iw - th) / 2.0;

        if (topology === "full") {
            layoutFullTopology(xy, n, r, w, th);
        } else if (topology === "ring") {
            layoutRingTopology(xy, n, r, w, th);
        } else if (topology === "star") {
            layoutStarTopology(xy, n, r, w, th);
        } else if (topology === "tree") {
            layoutTreeTopology(xy, n, nValue, w, iw);
        }

        // 获取连接线的颜色
        function getLinkColor(i, j) {
            var probability = probabilityMatrix[i][j] * 100;
            return setHeatmapBackgroundColor(probability);
        }

        // 绘制全连接拓扑背景
        function drawBackgroundFull(xy, g){
            for (var i = 0; i < xy.length; i++) {
                for (var j = 0; j < xy.length; j++) {
                    if (i != j) {
                        g.beginPath(); // 每条线单独开始路径
                        g.strokeStyle = getLinkColor(i, j);
                        g.moveTo(xy[i].x, xy[i].y);
                        g.lineTo(xy[j].x, xy[j].y);
                        g.stroke();
                    }
                }
            }
        }

        // 绘制环形拓扑背景
        function drawBackgroundRing(xy, g){
            for (var i = 0; i < xy.length; i++) {
                var next = (i + 1) % xy.length;
                g.beginPath(); // 每条线单独开始路径
                g.strokeStyle = getLinkColor(i, next);
                g.moveTo(xy[i].x, xy[i].y);
                g.lineTo(xy[next].x, xy[next].y);
                g.stroke();
            }
        }

        // 绘制星型拓扑背景
        function drawBackgroundStar(xy, g){
            for (var i = 1; i < xy.length; i++) {
                g.beginPath(); // 每条线单独开始路径
                g.strokeStyle = getLinkColor(0, i);
                g.moveTo(xy[0].x, xy[0].y);
                g.lineTo(xy[i].x, xy[i].y);
                g.stroke();
            }
        }

        // 绘制树型拓扑背景
        function drawTreeEdges(index) {
            if (index >= n) return;
            var childrenCount = nValue;
            for (var i = 0; i < childrenCount; i++) {
                var childIndex = index * nValue + i + 1;
                if (childIndex < n) {
                    g.beginPath(); // 每条线单独开始路径
                    g.strokeStyle = getLinkColor(index, childIndex);
                    g.moveTo(xy[index].x, xy[index].y);
                    g.lineTo(xy[childIndex].x, xy[childIndex].y);
                    g.stroke();
                    drawTreeEdges(childIndex);
                }
            }
        }

        // 绘制背景
        function drawBackground(){
            g.clearRect(0, 0, w, w);

            if (topology === "full") {
                drawBackgroundFull(xy, g)
            } else if (topology === "ring") {
                drawBackgroundRing(xy, g)
            } else if (topology === "star") {
                drawBackgroundStar(xy, g)
            } else if (topology === "tree") {
                drawTreeEdges(0);
            }
        }

        // 绘制前景
        function drawForeground(phase){
            for(var i=0; i<xy.length; i++){
                drawNode(g, i, xy[i].x, xy[i].y, isHonest(i), 
                  (phase == 0 && i == 0) || phase == 1 ? isHonest(i) ? prePrepare[i].value : null :
                  phase == 2 ? acceptedValueInPrepare(i) :
                  phase == 3 ? acceptedValueInCommit(i) : null);
            }
        }

		function bfs(matrix, start, end) {
			let queue = [[start]];
			let visited = new Array(matrix.length).fill(false);
			visited[start] = true;

			while (queue.length > 0) {
				let path = queue.shift();
				let node = path[path.length - 1];

				if (node === end) {
					return path;
				}

				for (let i = 0; i < matrix.length; i++) {
					if (matrix[node][i] > 0 && !visited[i]) {
						visited[i] = true;
						let newPath = path.slice();
						newPath.push(i);
						queue.push(newPath);
					}
				}
			}

			return null;
		}


		
		function sendMessage(matrix, src, dst, message, drawMessage, step, totalSteps) {
			let path = bfs(matrix, src, dst);
			if (!path) return false;

			let totalSegments = path.length - 1;
			let segmentStep = Math.floor(totalSteps / totalSegments);

			for (let i = 0; i < totalSegments; i++) {
				if (step >= i * segmentStep && step < (i + 1) * segmentStep) {
					let progress = (step - i * segmentStep) / segmentStep;
					let x1 = xy[path[i]].x;
					let y1 = xy[path[i]].y;
					let x2 = xy[path[i + 1]].x;
					let y2 = xy[path[i + 1]].y;

					let x = x1 + (x2 - x1) * progress;
					let y = y1 + (y2 - y1) * progress;

					drawMessage(message, x, y);
					break;
				}
			}

			return true;
		}

		function drawPhase(g, xy, messages, topology, drawMessage, phaseType, step, totalSteps) {
			for (let i = 0; i < xy.length; i++) {
				if (phaseType === 'preprepare' && i !== 0) continue; // 在预准备阶段，仅允许节点0传递消息

				for (let j = 0; j < xy.length; j++) {
					if (i === j) continue;

					
					let message;
					switch (phaseType) {
						case 'preprepare':
							message = messages[j];
							break;
						case 'prepare':
							message = messages[i].find(m => m.dst === j);
							break;
						case 'commit':
							message = messages[j].find(m => m.src === i);
							break;
					}

					if (message) {
						sendMessage(probabilityMatrix, i, j, message, drawMessage, step, totalSteps);
					}
				}
			}
		}

		
		
		
		function drawPrePreparePhase(step, totalSteps) {
			drawPhase(g, xy, prePrepare, topology, drawMessage, 'preprepare', step, totalSteps);
		}

		function drawPreparePhase(step, totalSteps) {
			drawPhase(g, xy, prepare, topology, drawMessage, 'prepare', step, totalSteps);
		}

		function drawCommitPhase(step, totalSteps) {
			drawPhase(g, xy, commit, topology, drawMessage, 'commit', step, totalSteps);
		}



        // 动画函数
		function animation(step) {
			drawBackground();
			if (step <= phaseStep) {
				drawPrePreparePhase(step, phaseStep);
			} else if (step > phaseStep && step <= 2 * phaseStep) {
				drawPreparePhase(step - phaseStep, phaseStep);
			} else if (step > 2 * phaseStep && step <= 3 * phaseStep) {
				drawCommitPhase(step - 2 * phaseStep, phaseStep);
			}
			drawForeground(Math.floor(step / phaseStep));
			
			// 点亮表格逻辑
			if (step == 0) {
				// 预准备阶段开始
				$(".bft_phase_preprepare").css({opacity: 0.2});
			}
			if (step <= phaseStep && (step + 1) >= phaseStep) {
				// 预准备阶段结束
				$(".bft_phase_preprepare").animate({opacity: 1.0}, "fast");
			}
			if (step <= 2 * phaseStep && (step + 1) >= 2 * phaseStep) {
				// 准备阶段结束
				$(".bft_phase_prepare").animate({opacity: 1.0}, "fast");
			}
			if (step <= 3 * phaseStep && (step + 1) >= 3 * phaseStep) {
				// 提交阶段结束
				$(".bft_phase_commit").animate({opacity: 1.0}, "fast");
			}

			if (step < phase * phaseStep) {
				timer = window.setTimeout(() => animation(step + 1), interval);
			} else {
				timer = null;
			}
		}


		
        $("#bft_description").height($("#bft_control").height());

        animation(0);

        console.log(n, m, f, screen.width(), screen.height(), xy, maliciousOrigin);
        return false;
    }

    // 生成概率矩阵
    function generateMatrix(n, topology, nValue) {
        var matrixContainer = document.getElementById("matrix_container");
        var matrixTable = document.getElementById("probabilityMatrix");

        // 清空之前的矩阵
        matrixTable.innerHTML = "";

        var fragment = document.createDocumentFragment();

        // 生成表头
        var headerRow = document.createElement("tr");
        var emptyCell = document.createElement("th");
        headerRow.appendChild(emptyCell);

        for (var i = 1; i <= n; i++) {
            var headerCell = document.createElement("th");
            headerCell.innerText = i;
            headerRow.appendChild(headerCell);
        }
        fragment.appendChild(headerRow);

        // 初始化概率矩阵
        probabilityMatrix = Array.from({ length: n }, () => Array(n).fill(0));

        // 根据拓扑结构生成矩阵
        for (var i = 0; i < n; i++) {
            var row = document.createElement("tr");
            var rowHeader = document.createElement("th");
            rowHeader.innerText = i + 1;
            row.appendChild(rowHeader);

            for (var j = 0; j < n; j++) {
                var cell = document.createElement("td");
                cell.classList.add('heatmap-cell');
                if (i === j) {
                    cell.innerText = "X"; // 自己到自己的连接设为不可编辑
                } else if (isConnectionAllowed(i, j, n, topology, nValue)) {
                    var input = document.createElement("input");
                    input.type = "number";
                    input.min = "0";
                    input.max = "100";
                    input.value = "100"; // 默认值为100%
                    input.dataset.row = i;
                    input.dataset.col = j;
                    input.addEventListener("change", updateProbability);
                    cell.appendChild(input);
                    probabilityMatrix[i][j] = 1; // 默认概率为1
                    cell.style.backgroundColor = setHeatmapBackgroundColor(input.value); // 设置初始背景色
                }
                row.appendChild(cell);
            }
            fragment.appendChild(row);
        }
        matrixTable.appendChild(fragment);
    }

    // 更新概率值
    function updateProbability(event) {
        var input = event.target;
        var row = input.dataset.row;
        var col = input.dataset.col;
        var value = input.value;

        // 更新对应的连接概率
        if (!isNaN(value) && value >= 0 && value <= 100) {
            probabilityMatrix[row][col] = value / 100; // 转换为0-1范围的概率
            exec();  // 重新执行动画以反映新的概率

            // 设置热图背景色
            input.parentNode.style.backgroundColor = setHeatmapBackgroundColor(value);
        }
    }

    // 用户设置变更时触发
    function onUserSettingsChange() {
        var n = parseInt(document.getElementById("bft_n").value);
        var topology = document.getElementById("topology").value;
        var nValue = parseInt(document.getElementById("n_value").value) || 2;

        generateMatrix(n, topology, nValue);

        exec();  // 在用户设置更改后重新执行动画
    }

    // 绑定事件
    $("#bft_exec").click(exec);

    // 当速度滑块值改变时重新执行动画
    $("#animation_speed").on("input", exec);

    // 根据拓扑选择显示/隐藏 N 值输入框
    $(document).ready(function() {
        $("#topology").change(function() {
            if ($(this).val() === "tree") {
                $("#n_value_group").show();
            } else {
                $("#n_value_group").hide();
            }
            onUserSettingsChange();
        });

        $("#bft_n").on("input", onUserSettingsChange);

        $("#n_value").on("input", onUserSettingsChange);

        // 展开/折叠矩阵
        $("#toggleMatrix").click(function() {
            var matrixScroll = $("#matrixScroll");
            if (matrixScroll.is(":visible")) {
                matrixScroll.hide();
                $(this).text("Expand");
            } else {
                matrixScroll.show();
                $(this).text("Collapse");
            }
        });

        // 缩放功能
        $("#zoom_level").on("input", function() {
            zoomLevel = parseFloat($(this).val());
            screen.css("transform", `scale(${zoomLevel})`);
        });

        // 拖动功能
        screen.on("mousedown", function(e) {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            screen.css("cursor", "grabbing");
        });

        $(document).on("mouseup", function() {
            isDragging = false;
            screen.css("cursor", "grab");
        });

        $(document).on("mousemove", function(e) {
            if (isDragging) {
                var dx = e.clientX - lastX;
                var dy = e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;
                offsetX += dx / zoomLevel;
                offsetY += dy / zoomLevel;
                screen.css("transform", `scale(${zoomLevel}) translate(${offsetX}px, ${offsetY}px)`);
            }
        });

        // 切换侧边栏
        $("#toggleSidebar").click(function() {
            var sidebar = $("#sidebar");
            if (sidebar.width() === 250) {
                sidebar.css("width", "50px");
            } else {
                sidebar.css("width", "250px");
            }
        });

        // 使用事件委托
        document.getElementById('probabilityMatrix').addEventListener('change', function(event) {
            if (event.target.tagName === 'INPUT') {
                updateProbability(event);
            }
        });

        onUserSettingsChange(); // 初始化时调用一次
    });

    exec();
})();
